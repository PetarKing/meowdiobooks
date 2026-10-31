"""Versioned Review precedence, with a private acceptance audit and immutable sources."""
from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from pathlib import Path

from meowdiobooks.util import write_json

from .review import (
    ReviewContractError, _accepted_repairs, _aggregate_consequences, _apply_cleanup_repairs,
    _consequence, _digest, _footnote_occurrences, _repair_text, _review_policy_span,
    _validate_verified_cue_sources, _validated_boundary_context, accepted_boundary_repairs,
)

POLICY_VERSION = 1
_CONTEXT = ('chapterId', 'renderRole', 'sourceSpeakerLabel', 'resolvedSpeakerLabel',
            'speakerStatus', 'speakerLabels', 'fallback')


def _index(review):
    return {str(row['id']): row for warning in review.get('warningSnapshot', [])
            for row in warning.get('occurrences', [])}


def _overlap(left, right):
    return (left['blockId'] == right['blockId']
            and max(left['sourceStart'], right['sourceStart'])
            < min(left['sourceEnd'], right['sourceEnd']))


def inclusion_policies(review):
    """Narrower scope wins; equally specific retention wins over omission."""
    rows = _index(review)
    return [(rows[d['occurrenceId']], d['action']) for d in review.get('decisions', [])
            if d['occurrenceId'] in rows and d['action'] in {'keep', 'exclude', 'narrate'}
            # Keeping a spelling suggestion is not a request to include an excluded note.
            and not (d['action'] == 'keep' and (rows[d['occurrenceId']].get('kind') == 'hyphenation'
                     or rows[d['occurrenceId']].get('boundaryDecision') is not None
                     or 'repair' in rows[d['occurrenceId']].get('availableActions', [])))]


def policy_at(policies, block, start, end):
    owners = [(row, action) for row, action in policies
              if row['blockId'] == block and row['sourceStart'] <= start < end <= row['sourceEnd']]
    return min(owners, key=lambda item: (item[0]['sourceEnd'] - item[0]['sourceStart'],
                                        {'keep': 0, 'narrate': 1, 'exclude': 2}[item[1]],
                                        item[0]['id'])) if owners else (None, 'keep')


def _policy_spans(dialogue, review):
    policies = inclusion_policies(review)
    result = []
    for span in dialogue.get('spans', []):
        start, end = span['sourceStart'], span['sourceEnd']
        owners = [(row, action) for row, action in policies if _overlap(row, span)]
        if not owners:
            result.append(dict(span))
            continue
        cuts = sorted({start, end, *(max(start, row['sourceStart']) for row, _ in owners),
                       *(min(end, row['sourceEnd']) for row, _ in owners)})
        pieces = []
        for left, right in zip(cuts, cuts[1:]):
            owner, action = policy_at(owners, span['blockId'], left, right)
            # Collapse identical adjacent policies before splitting the source span.
            key = owner['id'] if owner and action != 'keep' else None
            if pieces and pieces[-1][2:] == (action, key):
                pieces[-1] = (pieces[-1][0], right, action, key)
            else:
                pieces.append((left, right, action, key))
        if pieces == [(start, end, 'keep', None)]:
            result.append(dict(span))
        else:
            result.extend(_review_policy_span(span, *piece) for piece in pieces)
    return result


def _reading_context(span):
    role = span.get('renderRole', 'narration')
    if role == 'narration':
        return (span.get('chapterId'), role)
    return tuple(span.get(k) for k in _CONTEXT)


def _merge_for_repairs(spans, edits):
    """Only merge contiguous, retained pieces with identical reading context."""
    result = [dict(span) for span in spans]
    for edit in sorted(edits.values(), key=lambda e: (e['blockId'], e['sourceStart'], e['sourceEnd'])):
        indexes = [i for i, span in enumerate(result) if _overlap(span, edit)]
        if len(indexes) < 2:
            continue
        pieces = [result[i] for i in indexes]
        if (indexes != list(range(indexes[0], indexes[-1] + 1))
                or any(p.get('reviewAction') == 'exclude' for p in pieces)
                or any(_reading_context(p) != _reading_context(pieces[0]) for p in pieces)
                or any(a['sourceEnd'] != b['sourceStart']
                       or a.get('spokenEnd', a['sourceEnd']) != b.get('spokenStart', b['sourceStart'])
                       for a, b in zip(pieces, pieces[1:]))):
            continue
        merged = {**pieces[0], 'id': 'review-merge:' + _digest([p['id'] for p in pieces]),
                  'sourceEnd': pieces[-1]['sourceEnd'],
                  'spokenEnd': pieces[-1].get('spokenEnd', pieces[-1]['sourceEnd']),
                  'source': ''.join(p['source'] for p in pieces),
                  'text': ''.join(p.get('text', p['source']) for p in pieces), 'reviewAction': 'keep',
                  'reviewOccurrenceId': None}
        result[indexes[0]:indexes[-1] + 1] = [merged]
    return result


def render_resolved_review(dialogue, review):
    if review.get('renderPolicyVersion') != POLICY_VERSION:
        raise ReviewContractError('Unsupported Review render policy version')
    _validate_verified_cue_sources(dialogue, review)
    spans = _merge_for_repairs(_policy_spans(dialogue, review), _accepted_repairs(review))
    repaired = _apply_cleanup_repairs(spans, review)
    _validated_boundary_context(repaired, review)
    return {**dict(dialogue), 'spans': repaired}


def _source_blocks(dialogue):
    blocks = {}
    for span in dialogue.get('spans', []):
        blocks.setdefault(span['blockId'], []).append(span)
    result = []
    for key, spans in blocks.items():
        cursor, text = 0, ''
        for span in sorted(spans, key=lambda s: s['sourceStart']):
            if (span['sourceStart'] != cursor or not isinstance(span.get('source'), str)
                    or len(span['source']) != span['sourceEnd'] - cursor):
                raise ReviewContractError('Review resolution requires exact Dialogue source coverage')
            text += span['source']
            cursor = span['sourceEnd']
        result.append({'id': key, 'text': text, 'page': spans[0].get('page', 1)})
    return result


def resolve_review_revision(dialogue: Mapping, requested: Mapping):
    """Resolve a preview/new acceptance. Never call this on historical accepted renders."""
    review = deepcopy(dict(requested))
    review['renderPolicyVersion'] = POLICY_VERSION
    review['decisions'] = sorted(review.get('decisions', []), key=lambda d: d['occurrenceId'])
    rows = _index(review)
    choices = {d['occurrenceId']: d for d in review['decisions']}
    blocks = _source_blocks(dialogue)
    sources = {block['id']: block['text'] for block in blocks}
    events = []
    for row in rows.values():
        text = sources.get(row['blockId'], '')
        start, end = row['sourceStart'], row['sourceEnd']
        if not 0 <= start <= end <= len(text) or text[start:end] != row['source']:
            raise ReviewContractError('Review warning no longer matches its exact source')

    def skip(key, reason, related=()):
        if choices[key]['action'] == 'keep':
            return
        events.append({'occurrenceId': key, 'requestedAction': choices[key]['action'],
                       'effectiveAction': 'keep', 'reason': reason,
                       'relatedOccurrenceIds': sorted(related)})
        choices[key].update(action='keep', consequence=_consequence('keep', 1))

    # Recover saved pre-fix candidates only where the current deterministic detector
    # proves the same isolated note continues through a physically wrapped word.
    notes = {(r['blockId'], r['sourceStart']): r for r in _footnote_occurrences(blocks)}
    for key, row in rows.items():
        note = notes.get((row['blockId'], row['sourceStart']))
        if (row.get('kind') == 'footnote' and note and row['sourceEnd'] < note['sourceEnd']
                and row['source'] == note['source'][:len(row['source'])]
                and '\n' not in row['source'].rstrip('\r')):
            # Only a line-wrap continuation, never a newly detected whole note section.
            from .review import _LINE_HYPHEN
            if any(m.start() < row['sourceEnd'] - row['sourceStart'] < m.end()
                   for m in _LINE_HYPHEN.finditer(note['source'])):
                events.append({'occurrenceId': key, 'reason': 'wrapped-note-range',
                               'originalEnd': row['sourceEnd'], 'effectiveEnd': note['sourceEnd']})
                row.update(sourceEnd=note['sourceEnd'], source=note['source'])

    # Validate durable replacements and boundary evidence before considering suppression.
    edits = _accepted_repairs(review)
    for edit in edits.values():
        owners = [s for s in dialogue.get('spans', []) if _overlap(s, edit)]
        if len(owners) != 1:
            raise ReviewContractError('Cleanup repairs must stay inside one spoken source span')
        _repair_text(owners[0], [edit])
    boundary_keys = {key for key, row in rows.items() if row.get('boundaryDecision') is not None}
    evidence_view = {**review, 'decisions': [dict(d, action='keep') for d in review['decisions']]}
    accepted_boundary_repairs(evidence_view)
    boundary_repairs = {}
    for key in sorted(boundary_keys):
        if choices[key]['action'] != 'repair':
            continue
        isolated = {**evidence_view, 'decisions': [dict(d, action='repair' if d['occurrenceId'] == key else 'keep')
                                                  for d in evidence_view['decisions']]}
        repair, = accepted_boundary_repairs(isolated)
        # Original source identity must match even if this seam will later be skipped.
        for anchor in repair['anchors']:
            owner = next((s for s in dialogue.get('spans', []) if s['id'] == anchor['spanId']), None)
            if (owner is None or owner['blockId'] != anchor['blockId']
                    or not owner['sourceStart'] <= anchor['sourceStart'] < anchor['sourceEnd'] <= owner['sourceEnd']
                    or owner['source'][anchor['sourceStart']-owner['sourceStart']:anchor['sourceEnd']-owner['sourceStart']] != anchor['source']):
                raise ReviewContractError('Boundary anchor no longer matches its source')
        boundary_repairs[key] = repair

    # An explicit keep of a correction protects that correction's source range.
    kept = [r for key, r in rows.items() if choices.get(key, {}).get('action') == 'keep'
            and ('repair' in r.get('availableActions', []) or r.get('boundaryDecision'))]
    for key, edit in edits.items():
        protected = [r['id'] for r in kept if any(_overlap(edit, a) for a in r.get('boundaryAnchors', [r]))]
        if protected:
            skip(key, 'kept-correction', protected)

    # Dedicated spelling owns overlapping generic cleanup. Equal-priority disagreement
    # preserves source; identical proposals share one effective replacement.
    def priority(edit):
        return int(edit.get('kind') == 'hyphenation' or edit.get('hyphenDecision') is not None)
    candidates = sorted(edits, key=lambda key: (-priority(edits[key]), key))
    suppressed = set()
    for i, key in enumerate(candidates):
        if choices[key]['action'] == 'keep':
            continue
        for other in candidates[i + 1:]:
            if choices[other]['action'] == 'keep' or not _overlap(edits[key], edits[other]):
                continue
            a, b = edits[key], edits[other]
            identical = all(a.get(k) == b.get(k) for k in ('blockId', 'sourceStart', 'sourceEnd', 'source', 'replacement'))
            if identical or priority(a) > priority(b):
                skip(other, 'duplicate-correction' if identical else 'dedicated-spelling', [key])
            else:
                suppressed.update((key, other))
    for key in sorted(suppressed):
        skip(key, 'ambiguous-corrections', [other for other in suppressed if other != key and _overlap(edits[key], edits[other])])

    active_edits = _accepted_repairs(review)
    spans = _merge_for_repairs(_policy_spans(dialogue, review), active_edits)
    for key, edit in active_edits.items():
        owners = [span for span in spans if _overlap(span, edit)]
        if any(span.get('reviewAction') == 'exclude' for span in owners):
            skip(key, 'excluded-source' if all(s.get('reviewAction') == 'exclude' for s in owners)
                 else 'partly-excluded-source')
        elif len(owners) != 1:
            skip(key, 'incompatible-reading-context')
        else:
            _repair_text(owners[0], [edit])

    # Seam repairs are lowest precedence and must still fit the actual rendered spans.
    seam_conflicts = {}
    for key in sorted(boundary_repairs):
        others = [r['id'] for other, r in rows.items() if other != key
                  and choices.get(other, {}).get('action') in {'exclude', 'narrate', 'repair', 'keep-hyphen', 'join-word'}
                  and any(_overlap(a, b) for a in rows[key]['boundaryAnchors']
                          for b in r.get('boundaryAnchors', [r]))]
        protected = [r['id'] for r in kept if any(_overlap(a, b) for a in rows[key]['boundaryAnchors']
                                                for b in r.get('boundaryAnchors', [r]))]
        if others or protected:
            seam_conflicts[key] = others + protected
    for key, related in seam_conflicts.items():
        skip(key, 'boundary-owned-by-other-choice', related)
    for key in sorted(boundary_repairs):
        if choices[key]['action'] != 'repair':
            continue
        isolated = {**review, 'decisions': [dict(d, action='keep') if d['occurrenceId'] in boundary_keys
                                          and d['occurrenceId'] != key else d for d in review['decisions']]}
        rendered = _apply_cleanup_repairs(_merge_for_repairs(_policy_spans(dialogue, isolated), _accepted_repairs(isolated)), isolated)
        try:
            _validated_boundary_context(rendered, isolated)
        except ReviewContractError:
            skip(key, 'incompatible-boundary-context')

    policies = inclusion_policies(review)
    for block in blocks:
        relevant = [(r, a) for r, a in policies if r['blockId'] == block['id']]
        cuts = sorted({v for r, _ in relevant for v in (r['sourceStart'], r['sourceEnd'])})
        for left, right in zip(cuts, cuts[1:]):
            owners = [(r, a) for r, a in relevant if r['sourceStart'] <= left < right <= r['sourceEnd']]
            if len({a for _, a in owners}) > 1:
                owner, action = policy_at(owners, block['id'], left, right)
                events.append({'reason': 'inclusion-precedence', 'blockId': block['id'],
                               'sourceStart': left, 'sourceEnd': right, 'effectiveAction': action,
                               'occurrenceId': owner['id'], 'relatedOccurrenceIds': sorted(r['id'] for r, _ in owners)})
    rendered = render_resolved_review(dialogue, review)
    if 'consequencePreview' in review:
        review['consequencePreview'] = _aggregate_consequences(review['decisions'])
        review['receipt'] = {**review.get('receipt', {}), 'decisionDigest': _digest(review['decisions'])}
    audit = {'contract': 'meowdiobooks.review-resolution.v1', 'policyVersion': POLICY_VERSION,
             'reviewRevision': review.get('revision'), 'extractionRevision': review.get('extractionRevision'),
             'dialogueRevision': dialogue.get('revision'), 'sourceDigest': _digest(blocks),
             'requested': deepcopy(dict(requested)), 'effectiveDigest': _digest(review),
             'effectiveDecisions': deepcopy(review['decisions']), 'events': events,
             'renderedDigest': _digest(rendered['spans'])}
    return review, audit


def write_resolution_audit(package: Path, audit: Mapping):
    revision = str(audit.get('reviewRevision', ''))
    if not revision or any(c not in '0123456789abcdef' for c in revision):
        raise ReviewContractError('Resolution audit requires an immutable Review revision')
    path = package / '.audit' / 'review-resolution' / f'{revision}.json'
    if path.exists():
        raise ReviewContractError('Resolution audit already exists')
    write_json(path, audit)
