"""Script suggestions preserve source, manual decisions, and exact recording omissions."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.dialogue import malformed_playable_spans, scan_dialogue
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals,
    apply_review_render_policies, build_review_workspace, preview_review_transcript_page,
)


def fixture(texts=('ALICE: (said very loudly) Stay here.', 'BOB: [whispering] Stay close.')):
    blocks = [{'id': f'b{i}', 'page': 1, 'text': text} for i, text in enumerate(texts)]
    extraction = {'revision': 'e1', 'blocks': blocks}
    dialogue = scan_dialogue(blocks, enabled_profile_ids=['label-colon-line'])
    dialogue.update(revision='d1', extractionRevision='e1', spans=dialogue['partition'])
    # The accepted Dialogue contract also permits a user's speaker correction.
    for span in dialogue['spans']:
        if span['renderRole'] == 'narration' and ': ' in span['source']:
            label, speech = span['source'].split(': ', 1)
            span.update(renderRole='dialogue', spokenStart=len(label) + 2,
                        spokenEnd=span['sourceEnd'], text=speech,
                        sourceSpeakerLabel=label, resolvedSpeakerLabel=label,
                        speakerStatus='resolved', origin='user:dialogue-speaker')
    proposals = []
    for block in blocks:
        text = block['text']
        left = min(offset for offset, char in enumerate(text) if char in '([')
        right = text.rindex(')' if text[left] == '(' else ']') + 1
        proposals.append({'blockId': block['id'], 'sourceStart': left, 'sourceEnd': right,
            'source': text[left:right], 'page': 1, 'reason': 'Pure performance cue.',
            'policy': 'decisions-luna-script-directions-v1', 'model': 'gpt-6-luna',
            'recommendedAction': 'exclude'})
    result = {'occurrences': [], 'scriptDirections': {'occurrences': proposals,
              'summary': {'candidates': len(proposals), 'proposals': len(proposals),
                          'kept': 0, 'unavailable': 0}}}
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, result)
    return extraction, dialogue, workspace, result


def cues(workspace):
    return next(group for group in workspace['warnings'] if group['kind'] == 'stage-direction')['occurrences']


def noncue_choices(workspace):
    return [{'occurrenceIds': [row['id']], 'action': 'keep'} for group in workspace['warnings']
            if group['kind'] != 'stage-direction' for row in group['occurrences']]


def test_verified_cues_are_individual_keep_or_exclude_without_mutating_source():
    extraction, dialogue, workspace, result = fixture()
    before = deepcopy((extraction, dialogue, workspace, result))
    group = next(group for group in workspace['warnings'] if group['kind'] == 'stage-direction')
    assert group['decisionScope'] == 'occurrence'
    assert group['availableActions'] == ['keep', 'exclude']
    assert all(row['cueVerification'] == 'verified' and row['recommendedAction'] == 'exclude'
               and row['availableActions'] == ['keep', 'exclude'] for row in cues(workspace))
    review = accept_review_revision(workspace, noncue_choices(workspace), revision='r1')
    assert all(row['action'] == 'keep' for row in review['decisions'])
    assert apply_review_render_policies(dialogue, review)['spans'] == dialogue['spans']
    assert review['scriptDirectionsSummary'] == result['scriptDirections']['summary']
    assert (extraction, dialogue, workspace, result) == before


def test_manual_keep_survives_other_suggestions_and_recording_omits_exact_cue():
    extraction, dialogue, workspace, _ = fixture()
    first, second = cues(workspace)
    choices = noncue_choices(workspace) + [
        {'occurrenceIds': [first['id']], 'action': 'keep'},
        {'occurrenceIds': [second['id']], 'action': 'exclude'},
    ]
    review = accept_review_revision(workspace, choices, revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    assert not malformed_playable_spans(rendered)
    for block in extraction['blocks']:
        assert ''.join(span['source'] for span in rendered['spans']
                       if span['blockId'] == block['id']) == block['text']
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    speech = ''.join(row['text'] for row in script['entries'])
    assert '(said very loudly)' in speech
    assert '[whispering]' not in speech
    assert 'Stay close.' in speech and 'Stay here.' in speech
    assert any(row['kind'] == 'omission' and row['sourceText'] == '[whispering]'
               for row in script['entries'])


def test_preview_preserves_unselected_cues_and_matches_explicit_omission():
    extraction, dialogue, workspace, _ = fixture()
    policies = [{'warningId': w['id'], 'action': 'keep'} for w in workspace['warnings']
                if w['decisionScope'] != 'occurrence']
    preview = preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1)
    assert all(row['kind'] != 'excluded' for row in preview['spans'])
    preview = preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1,
        occurrence_policies=[{'occurrenceId': cues(workspace)[1]['id'], 'action': 'exclude'}])
    assert any(row['kind'] == 'excluded' and row['text'] == '[whispering]' for row in preview['spans'])
    with pytest.raises(ReviewContractError, match='individual preview'):
        preview_review_transcript_page(extraction, dialogue, workspace,
            policies + [{'warningId': 'review:stage-direction', 'action': 'exclude'}], page=1)


@pytest.mark.parametrize('field,value', [
    ('source', '(different)'), ('sourceStart', True), ('sourceEnd', 1000),
    ('policy', 'unverified'), ('model', 'other'), ('recommendedAction', 'narrate'),
])
def test_invalid_verified_anchors_cannot_become_review_candidates(field, value):
    extraction, dialogue, _, result = fixture()
    result['scriptDirections']['occurrences'][0][field] = value
    with pytest.raises(ReviewContractError):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_repeated_words_do_not_grant_cross_context_bulk_permission():
    _, _, workspace, _ = fixture(('ALICE: (softly) Wait.', 'BOB: (softly) Go.'))
    with pytest.raises(ReviewContractError, match='identical warning evidence'):
        accept_review_revision(workspace, [{'occurrenceIds': [row['id'] for row in cues(workspace)],
                                            'action': 'exclude'}], revision='r1')


def test_general_cleanup_cannot_bypass_preserved_brackets():
    extraction, dialogue, _, result = fixture()
    proposal = result['scriptDirections']['occurrences'].pop(0)
    result['occurrences'] = [{**proposal, 'replacement': ''}]
    with pytest.raises(ReviewContractError, match='protected bracketed content'):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


@pytest.mark.parametrize('mutation', ['source', 'missing', 'widened', 'unapproved'])
def test_recording_rejects_missing_or_changed_cue_omission(mutation):
    _, dialogue, workspace, _ = fixture()
    cue = cues(workspace)[0]
    review = accept_review_revision(workspace, noncue_choices(workspace) + [
        {'occurrenceIds': [cue['id']], 'action': 'exclude'}], revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    row = next(span for span in rendered['spans'] if span.get('reviewOccurrenceId') == cue['id'])
    if mutation == 'source':
        row['source'] = '(invented)'
    elif mutation == 'missing':
        rendered = dialogue
    elif mutation == 'widened':
        extra = next(span for span in rendered['spans']
                     if span['blockId'] == cue['blockId'] and span['sourceStart'] == cue['sourceEnd'])
        extra.update(reviewOccurrenceId=cue['id'], reviewAction='exclude', text='')
    else:
        next(choice for choice in review['decisions'] if choice['occurrenceId'] == cue['id'])['action'] = 'keep'
    with pytest.raises(ReviewContractError, match='[Ss]cript direction'):
        build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')


def test_legacy_saved_script_candidates_keep_their_original_choices():
    _, dialogue, workspace, _ = fixture()
    group = next(group for group in workspace['warnings'] if group['kind'] == 'stage-direction')
    group.update(decisionScope='warning-kind', availableActions=['keep', 'exclude', 'narrate'])
    for row in group['occurrences']:
        row.pop('cueVerification')
        row.pop('recommendedAction')
        row.update(availableActions=['keep', 'exclude', 'narrate'])
    with pytest.raises(ReviewContractError, match='No silent defaults'):
        accept_review_revision(workspace, noncue_choices(workspace), revision='r1')
    review = accept_review_revision(workspace, noncue_choices(workspace) + [
        {'occurrenceIds': [row['id']], 'action': 'narrate'} for row in group['occurrences']], revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    assert all(span['renderRole'] == 'narration' for span in rendered['spans']
               if span.get('reviewAction') == 'narrate')


@pytest.mark.parametrize('action', ['keep', 'exclude'])
def test_default_bracket_dialogue_keeps_attribution_and_exact_recording_source(action):
    text = 'MARA: [said softly] Stay close.'
    extraction = {'revision': 'e1', 'blocks': [{'id': 'b', 'page': 1, 'text': text}]}
    dialogue = scan_dialogue(extraction['blocks'])
    dialogue.update(revision='d1', extractionRevision='e1', spans=dialogue['partition'])
    before = deepcopy(dialogue)
    start = text.index('[')
    proposal = {'blockId': 'b', 'sourceStart': start, 'sourceEnd': text.index(']') + 1,
                'source': '[said softly]', 'recommendedAction': 'exclude',
                'policy': 'decisions-luna-script-directions-v1', 'model': 'gpt-6-luna'}
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction,
        dialogue, {'occurrences': [], 'scriptDirections': {'occurrences': [proposal]}})
    cue = cues(workspace)[0]
    review = accept_review_revision(workspace, noncue_choices(workspace) + [
        {'occurrenceIds': [cue['id']], 'action': action}], revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    assert dialogue == before
    assert ''.join(span['source'] for span in rendered['spans']) == text
    assert not malformed_playable_spans(rendered)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    speech = ''.join(entry['text'] for entry in script['entries'])
    assert ('said softly' in speech) == (action == 'keep')
    assert 'MARA:' not in speech
    assert 'Stay close.' in speech
    # Review does not silently reassign the following prose to another speaker.
    assert next(span for span in rendered['spans'] if span['source'] == ' Stay close.')['renderRole'] == 'narration'
    if action == 'exclude':
        assert any(entry['kind'] == 'omission' and entry['sourceText'] == '[said softly]'
                   for entry in script['entries'])


def test_separate_explicit_passage_exclusion_retains_existing_cross_category_precedence():
    extraction, dialogue, workspace, _ = fixture(('ALICE: (softly) Stay here.',))
    cue = cues(workspace)[0]
    block = extraction['blocks'][0]
    passage = {**cue, 'id': 'passage', 'warningId': 'review:front-back-matter',
               'kind': 'front-back-matter', 'sourceStart': 0, 'sourceEnd': len(block['text']),
               'source': block['text'], 'availableActions': ['keep', 'exclude']}
    passage.pop('cueVerification')
    workspace['warnings'].append({'id': 'review:front-back-matter', 'kind': 'front-back-matter',
                                  'occurrences': [passage], 'decisionScope': 'warning-kind'})
    review = accept_review_revision(workspace, [
        {'occurrenceIds': [cue['id']], 'action': 'keep'},
        {'occurrenceIds': ['passage'], 'action': 'exclude'},
    ], revision='r1')
    # Keeping a cue does not reinsert it into a separately excluded whole passage.
    assert next(row for row in review['decisions'] if row['occurrenceId'] == cue['id'])['action'] == 'keep'
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert all(row['kind'] == 'omission' for row in script['entries'])
    assert ''.join(row['sourceText'] for row in script['entries']) == block['text']
