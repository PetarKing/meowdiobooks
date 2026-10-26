"""Accepted cleanup changes speech while preserving immutable source and reader identity."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.dialogue import malformed_playable_spans
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals,
    apply_review_render_policies, build_review_workspace as build_current_workspace, preview_review_transcript_page,
)


def build_review_workspace(extraction, dialogue):
    """Exercise cleanup compatibility with the persisted pre-hyphen-choice format.

    Current hyphen ownership and repair choices have their own end-to-end tests.
    """
    workspace = build_current_workspace(extraction, dialogue)
    for warning in workspace['warnings']:
        if warning['kind'] != 'hyphenation':
            continue
        warning.update(id='review:suspicious-extraction', kind='suspicious-extraction',
                       decisionScope='warning-kind')
        actions = ['keep', 'exclude'] if warning['readerState'] == 'narrator' else ['keep', 'narrate', 'exclude']
        warning['availableActions'] = actions
        for row in warning['occurrences']:
            row.update(kind='suspicious-extraction', warningId=warning['id'], availableActions=actions)
            row.pop('hyphenChoices', None)
    return workspace


def fixture(source='Ada: [A bro-\nken sign.]', before='bro-\nken', after='broken'):
    left, right = source.index('[') + 1, source.index(']')
    extraction = {'revision': 'e1', 'blocks': [{'id': 'b', 'page': 1, 'text': source}]}
    dialogue = {'revision': 'd1', 'extractionRevision': 'e1', 'spans': [{
        'id': 's1', 'blockId': 'b', 'page': 1, 'sourceStart': 0, 'sourceEnd': len(source),
        'spokenStart': left, 'spokenEnd': right, 'source': source, 'text': source[left:right],
        'renderRole': 'dialogue', 'sourceSpeakerLabel': 'Ada', 'resolvedSpeakerLabel': 'Ada',
        'speakerStatus': 'resolved', 'chapterId': 'chapter-1',
    }]}
    start = source.index(before)
    proposal = {'blockId': 'b', 'sourceStart': start, 'sourceEnd': start + len(before),
                'source': before, 'replacement': after, 'reason': 'Line wrap in a word.'}
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': [proposal]})
    return extraction, dialogue, workspace, proposal


def decisions(workspace, action='repair'):
    return [{'occurrenceIds': [row['id']], 'action': action if row.get('proposalStatus') else 'keep'}
            for warning in workspace['warnings'] for row in warning['occurrences']]


def test_repair_preserves_source_speaker_and_generation_script():
    extraction, dialogue, workspace, _ = fixture()
    before = deepcopy((extraction, dialogue, workspace))
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    row = rendered['spans'][0]
    assert row['source'] == dialogue['spans'][0]['source']
    assert row['text'] == 'A broken sign.'
    assert row['resolvedSpeakerLabel'] == 'Ada'
    assert row['spokenStart'] == dialogue['spans'][0]['spokenStart']
    assert (extraction, dialogue, workspace) == before
    # Raw dialogue still rejects a rewritten playable interval; only verified review
    # evidence grants the recording-script renderer permission to use changed speech.
    assert malformed_playable_spans(rendered)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert script['entries'][0]['text'] == 'A broken sign.'
    assert script['entries'][0]['sourceText'] == row['source']
    assert script['entries'][0]['provenance'].startswith('review:repair:')


def test_keep_proposal_preserves_original_spoken_text():
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, decisions(workspace, 'keep'), revision='r1')
    assert apply_review_render_policies(dialogue, review)['spans'] == dialogue['spans']


def test_deletion_of_entire_spoken_text_is_an_explicit_omission():
    _, dialogue, workspace, _ = fixture('Ada: [Publisher credit]', 'Publisher credit', '')
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert script['entries'][0]['kind'] == 'omission'
    assert script['entries'][0]['text'] == ''
    assert script['entries'][0]['sourceText'] == 'Ada: [Publisher credit]'


def test_preview_matches_accepted_repair_and_requires_individual_choices():
    extraction, dialogue, workspace, _ = fixture()
    policies = [{'warningId': warning['id'], 'action': 'keep'} for warning in workspace['warnings']
                if warning.get('decisionScope') != 'occurrence']
    with pytest.raises(ReviewContractError, match='Every cleanup'):
        preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1)
    ai = next(row for w in workspace['warnings'] for row in w['occurrences'] if row.get('proposalStatus'))
    preview = preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1,
                                           occurrence_policies=[{'occurrenceId': ai['id'], 'action': 'repair'}])
    assert preview['spans'][0]['text'] == 'A broken sign.'
    assert preview['spans'][0]['reader'] == 'Ada'


@pytest.mark.parametrize('mutation', ['source', 'range', 'speaker-label', 'overlap'])
def test_invalid_proposal_cannot_be_persisted(mutation):
    extraction, dialogue, _, proposal = fixture()
    proposals = [proposal]
    if mutation == 'source':
        proposal['source'] = 'invented'
    elif mutation == 'range':
        proposal['sourceEnd'] += 1
    elif mutation == 'speaker-label':
        proposal.update(sourceStart=0, sourceEnd=3, source='Ada')
    else:
        proposals.append(dict(proposal))
    with pytest.raises(ReviewContractError):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue,
                              {'occurrences': proposals})


@pytest.mark.parametrize('mutation', ['text', 'revision', 'id'])
def test_script_rejects_unapproved_or_stale_repair(mutation):
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    row = rendered['spans'][0]
    if mutation == 'text':
        row['text'] = 'A different story.'
    elif mutation == 'revision':
        row['reviewRevision'] = 'old-review'
    else:
        row['reviewRepairs'] = ['unknown']
    with pytest.raises(ReviewContractError):
        build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')


def test_source_review_can_never_be_accepted_as_repair():
    _, _, workspace, _ = fixture(after=None)
    with pytest.raises(ReviewContractError, match='not supported'):
        accept_review_revision(workspace, decisions(workspace), revision='r1')


def test_script_cannot_silently_ignore_an_accepted_repair():
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    with pytest.raises(ReviewContractError, match='missing'):
        build_recording_script(dialogue, review, {'revision': 'c1'}, revision='s1')


def test_repair_cannot_be_transferred_to_identical_text_in_another_block():
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    rendered['spans'][0]['blockId'] = 'other-block'
    with pytest.raises(ReviewContractError, match='spoken source'):
        build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')


def test_accept_all_is_explicit_individual_decisions_not_identical_evidence_bulk():
    extraction, dialogue, workspace, proposal = fixture()
    second = {**proposal, 'sourceStart': 6, 'sourceEnd': 7, 'source': 'A', 'replacement': 'An'}
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction,
                                      dialogue, {'occurrences': [proposal, second]})
    ai = [r for w in workspace['warnings'] for r in w['occurrences'] if r.get('proposalStatus')]
    with pytest.raises(ReviewContractError, match='identical'):
        accept_review_revision(workspace, [{'occurrenceIds': [r['id'] for r in ai],
                                            'action': 'repair'}], revision='bad')
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    assert apply_review_render_policies(dialogue, review)['spans'][0]['text'] == 'An broken sign.'


def test_exact_cleanup_match_moves_to_ai_category_without_duplicate_or_mutation():
    extraction, dialogue, _, proposal = fixture()
    deterministic = build_review_workspace(extraction, dialogue)
    before = deepcopy(deterministic)
    known = next(row for warning in deterministic['warnings'] for row in warning['occurrences']
                 if row['source'] == 'bro-\nken')
    workspace = add_cleanup_proposals(deterministic, extraction, dialogue, {'occurrences': [proposal]})
    assert deterministic == before
    rows = [row for warning in workspace['warnings'] for row in warning['occurrences']]
    assert len(rows) == deterministic['summary']['occurrences']
    row = next(row for row in rows if row['id'] == known['id'])
    assert row['kind'] == 'ai-cleanup'
    assert row['warningId'] == 'review:ai-cleanup'
    assert row['source'] == known['source']
    assert row['reason'] == known['reason']
    assert row['cleanupReason'] == proposal['reason']
    assert row['replacement'] == 'broken'
    assert row['proposalStatus'] == 'proposed'
    assert 'repair' in row['availableActions']
    assert next(w for w in workspace['warnings'] if row in w['occurrences'])['decisionScope'] == 'occurrence'


def test_disambiguating_ai_context_projects_onto_existing_whole_word_anchor():
    extraction, dialogue, _, proposal = fixture()
    text = extraction['blocks'][0]['text']
    anchor = 'A bro-\nken sign.'
    start = text.index(anchor)
    proposal.update(sourceStart=start, sourceEnd=start + len(anchor), source=anchor,
                    replacement='A broken sign.')
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': [proposal]})
    rows = [row for warning in workspace['warnings'] for row in warning['occurrences']]
    assert sum(row['kind'] == 'ai-cleanup' for row in rows) == 1
    enriched = next(row for row in rows if row.get('proposalStatus'))
    assert enriched['source'] == 'bro-\nken'
    assert enriched['replacement'] == 'broken'
    review = accept_review_revision(workspace, decisions(workspace), revision='projected')
    assert apply_review_render_policies(dialogue, review)['spans'][0]['text'] == 'A broken sign.'


def test_ambiguous_partial_overlap_preserves_novel_proposal():
    extraction, dialogue, _, proposal = fixture()
    text = extraction['blocks'][0]['text']
    anchor = '\nken sign'
    start = text.index(anchor)
    proposal.update(sourceStart=start, sourceEnd=start + len(anchor), source=anchor,
                    replacement='ken sign')
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': [proposal]})
    assert {w['kind'] for w in workspace['warnings']} >= {'suspicious-extraction', 'ai-cleanup'}
    novel = next(w for w in workspace['warnings'] if w['kind'] == 'ai-cleanup')['occurrences'][0]
    assert novel['source'] == anchor
    assert novel['replacement'] == 'ken sign'


def test_source_review_exact_duplicate_retains_existing_deterministic_choices():
    extraction, dialogue, workspace, _ = fixture(after=None)
    assert not any(w['kind'] == 'ai-cleanup' for w in workspace['warnings'])
    row = next(r for w in workspace['warnings'] for r in w['occurrences'] if r.get('proposalStatus'))
    assert row['proposalStatus'] == 'source_review'
    assert row['replacement'] is None
    assert 'repair' not in row['availableActions']
    assert {'keep', 'exclude'} <= set(row['availableActions'])
    assert 'rerun-extraction' not in row['availableActions']


def test_moved_correction_and_remaining_deterministic_group_have_separate_policies():
    extraction, dialogue, workspace, _ = fixture('Ada: [A bro-\nken sign and a dam-\naged fence.]')
    group = next(w for w in workspace['warnings'] if w['kind'] == 'suspicious-extraction')
    ai = next(w for w in workspace['warnings'] if w['kind'] == 'ai-cleanup')
    assert group['decisionScope'] == 'warning-kind'
    assert len(group['occurrences']) == group['occurrenceCount'] == 1
    assert group['occurrences'][0]['source'] == 'dam-\naged'
    assert ai['decisionScope'] == 'occurrence'
    enriched = ai['occurrences'][0]
    policies = [{'warningId': w['id'], 'action': 'keep'} for w in workspace['warnings']
                if w.get('decisionScope') != 'occurrence']
    with pytest.raises(ReviewContractError, match='Every cleanup'):
        preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1)
    selected = [{'occurrenceId': enriched['id'], 'action': 'repair'}]
    preview = preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1,
                                            occurrence_policies=selected)
    assert preview['spans'][0]['text'] == 'A broken sign and a dam-\naged fence.'
    review = accept_review_revision(workspace, decisions(workspace), revision='mixed-choices')
    script = build_recording_script(apply_review_render_policies(dialogue, review), review,
                                    {'revision': 'c1'}, revision='s1')
    assert script['entries'][0]['text'] == preview['spans'][0]['text']
    assert script['entries'][0]['sourceText'] == dialogue['spans'][0]['source']


def test_augmented_group_preserves_individual_reader_roles():
    extraction, dialogue, _, proposal = fixture()
    other = 'A dam-\naged fence.'
    extraction['blocks'].append({'id': 'narration', 'page': 1, 'text': other})
    dialogue['spans'].append({
        'id': 'narration-span', 'blockId': 'narration', 'page': 1,
        'sourceStart': 0, 'sourceEnd': len(other), 'source': other, 'text': other,
        'renderRole': 'narration', 'chapterId': 'chapter-1',
    })
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': [proposal]})
    group = next(w for w in workspace['warnings'] if w['kind'] == 'suspicious-extraction')
    assert group['readerState'] == 'narrator'
    rows = {row['blockId']: row for w in workspace['warnings'] for row in w['occurrences']}
    assert rows['b']['readerState'] != 'narrator'
    assert rows['b']['kind'] == 'ai-cleanup'
    assert rows['narration']['readerState'] == 'narrator'
    assert 'narrate' not in rows['narration']['availableActions']


def test_nested_source_review_enriches_unique_containing_deterministic_finding():
    extraction, dialogue, workspace, _ = fixture('Ada: [The last word was lost �.]', '�', None)
    rows = [row for warning in workspace['warnings'] for row in warning['occurrences']]
    assert not any(row['kind'] == 'ai-cleanup' for row in rows)
    enriched = next(row for row in rows if row.get('proposalStatus'))
    assert enriched['kind'] == 'suspicious-extraction'
    assert 'The last word was lost �.' in enriched['source']
    assert enriched['replacement'] is None
    assert enriched['proposalStatus'] == 'source_review'
    assert 'repair' not in enriched['availableActions']
    review = accept_review_revision(workspace, decisions(workspace, 'keep'), revision='keep-source')
    assert apply_review_render_policies(dialogue, review)['spans'] == dialogue['spans']


def test_nested_source_review_with_multiple_containing_owners_stays_separate():
    extraction, dialogue, _, proposal = fixture('Ada: [The last word was lost �.]', '�', None)
    workspace = build_review_workspace(extraction, dialogue)
    original = next(w for w in workspace['warnings'] if w['kind'] == 'suspicious-extraction')
    other = deepcopy(original)
    other['id'] = 'review:reading-order'
    other['kind'] = 'reading-order'
    for row in other['occurrences']:
        row.update(id=row['id'] + ':reading-order', warningId=other['id'], kind='reading-order')
    workspace['warnings'].append(other)
    result = add_cleanup_proposals(workspace, extraction, dialogue, {'occurrences': [proposal]})
    ai = next(w for w in result['warnings'] if w['kind'] == 'ai-cleanup')['occurrences'][0]
    assert ai['source'] == '�'
    assert ai['replacement'] is None
    assert all(not row.get('proposalStatus') for w in result['warnings'] if w['kind'] != 'ai-cleanup'
               for row in w['occurrences'])


def test_leave_ai_suggestion_excludes_only_anchored_text_and_preserves_source():
    _, dialogue, workspace, _ = fixture()
    review = accept_review_revision(workspace, decisions(workspace, 'exclude'), revision='leave-ai')
    rendered = apply_review_render_policies(dialogue, review)
    assert ''.join(row['text'] for row in rendered['spans'] if row.get('renderRole') != 'excluded') == 'A  sign.'
    assert ''.join(row['source'] for row in rendered['spans']) == dialogue['spans'][0]['source']


def test_new_review_findings_do_not_offer_pdf_reextraction():
    from meowdiobooks.backend.review import WARNING_CONFIG
    assert all('rerun-extraction' not in config['actions'] for config in WARNING_CONFIG.values())


def test_ai_corrections_form_last_group_with_no_empty_or_duplicate_groups():
    source = 'Ada: [A bro-\nken sign and a dam-\naged fence.]'
    extraction, dialogue, _, proposal = fixture(source)
    credit = 'Human translated by:'
    extraction['blocks'].append({'id': 'credit', 'page': 2, 'text': credit})
    dialogue['spans'].append({'id': 'credit-span', 'blockId': 'credit', 'page': 2,
        'sourceStart': 0, 'sourceEnd': len(credit), 'source': credit, 'text': credit,
        'renderRole': 'narration', 'chapterId': 'chapter-1'})
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': [proposal]})
    assert [w['kind'] for w in workspace['warnings']] == [
        'suspicious-extraction', 'ai-cleanup']
    rows = [row for w in workspace['warnings'] for row in w['occurrences']]
    assert len({row['id'] for row in rows}) == len(rows)
    assert sum(row['source'] == 'bro-\nken' for row in rows) == 1
    assert all(w['occurrenceCount'] == len(w['occurrences']) > 0 for w in workspace['warnings'])


def test_no_ai_repairs_preserves_narrate_policy_for_mixed_deterministic_group():
    extraction, dialogue, _, _ = fixture()
    text = 'A dam-\naged fence.'
    extraction['blocks'].append({'id': 'n', 'page': 1, 'text': text})
    dialogue['spans'].append({'id': 'n-span', 'blockId': 'n', 'page': 1,
        'sourceStart': 0, 'sourceEnd': len(text), 'source': text, 'text': text,
        'renderRole': 'narration', 'chapterId': 'chapter-1'})
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, {'occurrences': []})
    group = next(w for w in workspace['warnings'] if w['kind'] == 'suspicious-extraction')
    assert group['readerState'] == 'mixed'
    assert all('narrate' in row['availableActions'] for row in group['occurrences'])
    policies = [{'warningId': w['id'], 'action': 'narrate' if w is group else 'keep'}
                for w in workspace['warnings']]
    preview = preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1)
    assert preview['page'] == 1
    choices = [{'occurrenceIds': [row['id']], 'action': 'narrate' if w is group else 'keep'}
               for w in workspace['warnings'] for row in w['occurrences']]
    accept_review_revision(workspace, choices, revision='mixed-narration')
