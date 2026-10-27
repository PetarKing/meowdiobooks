"""Precedence must preserve source, be order-independent and reach the recording script."""
from copy import deepcopy
from itertools import permutations

import pytest

from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, apply_review_render_policies,
    build_review_workspace,
)
from meowdiobooks.backend.review_resolution import resolve_review_revision, write_resolution_audit
from meowdiobooks.backend.recording_script import build_recording_script
from test_review_note_overlap import artifacts


def row(text, key, start, end, kind='footnote', replacement=None):
    result = {'id': key, 'warningId': key, 'blockId': 'b', 'sourceStart': start,
              'sourceEnd': end, 'source': text[start:end], 'kind': kind, 'page': 1,
              'availableActions': ['keep', 'exclude', 'narrate']}
    if kind == 'ai-cleanup':
        result.update(replacement=replacement, proposalStatus='proposed', availableActions=['keep', 'exclude', 'repair'])
    return result


def requested(rows, actions):
    return {'revision': 'ab12', 'dialogueRevision': 'd1', 'extractionRevision': 'e1',
            'warningSnapshot': [{'id': r['id'], 'occurrences': [r]} for r in rows],
            'decisions': [{'occurrenceId': r['id'], 'action': a} for r, a in zip(rows, actions)]}


def execute(text, rows, actions, dialogue=None):
    _, default_dialogue = artifacts(text)
    dialogue = dialogue or default_dialogue
    original = deepcopy((dialogue, rows))
    review, audit = resolve_review_revision(dialogue, requested(rows, actions))
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert ''.join(s['source'] for s in rendered['spans']) == text
    assert (dialogue, rows) == original
    return ''.join(e['text'] for e in script['entries']), review, audit


@pytest.mark.parametrize('narrow_action,expected', [('keep', 'cde'), ('narrate', 'cde'), ('exclude', '')])
def test_specific_inclusion_overrides_broad_removal_in_any_order(narrow_action, expected):
    text = 'abcdefg'
    rows = [row(text, 'wide', 0, 7), row(text, 'narrow', 2, 5)]
    result, _, audit = execute(text, rows, ['exclude', narrow_action])
    assert result == expected
    reversed_result, _, _ = execute(text, rows[::-1], [narrow_action, 'exclude'])
    assert reversed_result == result
    assert bool(audit['events']) == (narrow_action != 'exclude')


@pytest.mark.parametrize('action,expected', [('keep', 'abcdef'), ('narrate', 'abcdef')])
def test_equal_scope_retention_wins_over_exclusion(action, expected):
    text = 'abcdef'
    assert execute(text, [row(text, 'a', 0, 6), row(text, 'b', 0, 6)], ['exclude', action])[0] == expected


def test_partial_policies_preserve_only_specifically_included_source():
    text = 'abcdefghij'
    rows = [row(text, 'a', 0, 7), row(text, 'b', 4, 10)]
    assert execute(text, rows, ['exclude', 'keep'])[0] == 'efghij'


@pytest.mark.parametrize('start,end,reason', [(0, 16, 'excluded-source'), (0, 8, 'partly-excluded-source')])
def test_removal_suppresses_whole_correction_without_resurrecting_text(start, end, reason):
    text = 'A bro-\nken sign.'
    rows = [row(text, 'omit', start, end), row(text, 'fix', 2, 10, 'ai-cleanup', 'broken')]
    result, review, audit = execute(text, rows, ['exclude', 'repair'])
    assert result == text[end:]
    assert review['decisions'][0]['action'] == 'keep'  # fix sorts before omit
    assert any(e['reason'] == reason for e in audit['events'])


def test_retained_narration_pieces_can_share_a_correction():
    text = 'A bro-\nken sign.'
    rows = [row(text, 'narrate', 0, 8), row(text, 'fix', 2, 10, 'ai-cleanup', 'broken')]
    result, _, audit = execute(text, rows, ['narrate', 'repair'])
    assert result == 'A broken sign.'
    assert not any(e.get('occurrenceId') == 'fix' for e in audit['events'])


def test_different_readers_are_not_joined_for_a_correction():
    text = 'A bro-\nken sign.'
    _, dialogue = artifacts(text)
    dialogue['spans'][0].update(renderRole='dialogue', sourceSpeakerLabel='Ada', resolvedSpeakerLabel='Ada')
    rows = [row(text, 'narrate', 0, 8), row(text, 'fix', 2, 10, 'ai-cleanup', 'broken')]
    result, _, audit = execute(text, rows, ['narrate', 'repair'], dialogue)
    assert result == text
    assert any(e['reason'] == 'incompatible-reading-context' for e in audit['events'])


@pytest.mark.parametrize('second,expected,reason', [('broken', 'A broken sign.', 'duplicate-correction'),
                                                   ('bro-ken', 'A bro-\nken sign.', 'ambiguous-corrections')])
def test_overlapping_replacements_are_deduplicated_or_kept(second, expected, reason):
    text = 'A bro-\nken sign.'
    rows = [row(text, 'a', 2, 10, 'ai-cleanup', 'broken'), row(text, 'b', 2, 10, 'ai-cleanup', second)]
    for order in permutations(rows):
        result, _, audit = execute(text, list(order), ['repair', 'repair'])
        assert result == expected
        assert any(e['reason'] == reason for e in audit['events'])


def test_explicit_keep_beats_overlapping_cleanup_and_dedicated_spelling_beats_generic():
    text = 'A bro-\nken sign.'
    rows = [row(text, 'a', 2, 10, 'ai-cleanup', 'broken'), row(text, 'b', 2, 10, 'ai-cleanup', 'bro-ken')]
    assert execute(text, rows, ['keep', 'repair'])[0] == text
    rows[0]['hyphenDecision'] = 'KEEP'
    assert execute(text, rows, ['repair', 'repair'])[0] == 'A broken sign.'


def test_disjoint_length_changing_repairs_and_tamper_guard():
    text = 'A bro-\nken re-\ncord.'
    rows = [row(text, 'a', 2, 10, 'ai-cleanup', 'broken'), row(text, 'b', 11, 19, 'ai-cleanup', 'record')]
    assert execute(text, rows, ['repair', 'repair'])[0] == 'A broken record.'
    rows[0]['source'] = 'invented'
    with pytest.raises(ReviewContractError, match='exact source'):
        execute(text, rows, ['repair', 'repair'])


def test_saved_note_draft_auto_recovers_but_historical_receipt_stays_strict():
    text = '[4] A scholar stud-\n ied the records.\nStory resumes.'
    extraction, dialogue = artifacts(text)
    workspace = build_review_workspace(extraction, dialogue)
    note = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')['occurrences'][0]
    note.update(sourceEnd=text.index('\n'), source=text.split('\n')[0])
    repair = next(w for w in workspace['warnings'] if w['kind'] == 'hyphenation')['occurrences'][0]
    draft = requested([note, repair], ['exclude', 'join-word'])
    with pytest.raises(ReviewContractError, match='crosses another'):
        apply_review_render_policies(dialogue, draft)
    resolved, audit = resolve_review_revision(dialogue, draft)
    rendered = apply_review_render_policies(dialogue, resolved)
    assert ''.join(s['text'] for s in rendered['spans'] if s.get('reviewAction') != 'exclude').strip() == 'Story resumes.'
    assert {'wrapped-note-range', 'excluded-source'} <= {e['reason'] for e in audit['events']}


def test_audit_is_private_and_immutable(tmp_path):
    _, dialogue = artifacts('Plain text.')
    resolved, audit = resolve_review_revision(dialogue, requested([], []))
    write_resolution_audit(tmp_path, audit)
    assert (tmp_path / '.audit/review-resolution/ab12.json').is_file()
    assert not (tmp_path / 'artifacts').exists()
    assert not {'events', 'requested', 'effectiveDecisions'} & resolved.keys()
    with pytest.raises(ReviewContractError, match='already exists'):
        write_resolution_audit(tmp_path, audit)


@pytest.mark.parametrize('mutation', ['missing', 'text'])
def test_resolved_correction_is_still_verified_in_recording_script(mutation):
    text = 'A bro-\nken sign.'
    _, dialogue = artifacts(text)
    review, _ = resolve_review_revision(dialogue, requested([row(text, 'fix', 2, 10, 'ai-cleanup', 'broken')], ['repair']))
    rendered = apply_review_render_policies(dialogue, review)
    if mutation == 'missing':
        rendered['spans'][0].pop('reviewRepairs')
    else:
        rendered['spans'][0]['text'] = 'invented'
    with pytest.raises(ReviewContractError):
        build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')


def test_boundary_context_skip_and_source_tamper_remain_distinct(monkeypatch):
    from test_boundary_review import review_workspace
    _, dialogue, workspace = review_workspace(monkeypatch)
    choices = [{'occurrenceIds': [r['id']], 'action': 'repair' if r.get('boundaryDecision') else 'keep'}
               for w in workspace['warnings'] for r in w['occurrences']]
    review = accept_review_revision(workspace, choices, revision='ab12', resolve_overlaps=True)
    dialogue['spans'][-1]['chapterId'] = 'different-chapter'
    resolved, audit = resolve_review_revision(dialogue, review)
    assert all(d['action'] == 'keep' for d in resolved['decisions'])
    assert any(e['reason'] == 'incompatible-boundary-context' for e in audit['events'])
    dialogue['spans'][-1]['source'] = 'wrong'
    with pytest.raises(ReviewContractError):
        resolve_review_revision(dialogue, review)


def test_kept_cue_cannot_be_rerouted_to_narration_after_resolution():
    from test_script_direction_review import fixture, noncue_choices
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, noncue_choices(workspace), revision='ab12', resolve_overlaps=True)
    resolved, _ = resolve_review_revision(dialogue, review)
    rendered = apply_review_render_policies(dialogue, resolved)
    rendered['spans'][0].update(reviewAction='narrate', renderRole='narration',
                                 sourceSpeakerLabel=None, resolvedSpeakerLabel=None)
    with pytest.raises(ReviewContractError, match='differs from its accepted choice'):
        build_recording_script(rendered, resolved, {'revision': 'c1'}, revision='s1')
