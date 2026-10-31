"""Explicit spelling choices flow from review through preview and recording script."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals,
    apply_review_render_policies, build_review_workspace, preview_review_transcript_page,
)


def artifacts(word):
    text = f'I have {word} today.'
    extraction = {'revision': 'e1', 'blocks': [{'id': 'b', 'page': 1, 'text': text}]}
    dialogue = {'revision': 'd1', 'extractionRevision': 'e1', 'spans': [{
        'id': 's', 'blockId': 'b', 'sourceStart': 0, 'sourceEnd': len(text),
        'source': text, 'text': text, 'renderRole': 'dialogue',
        'sourceSpeakerLabel': 'Ada', 'resolvedSpeakerLabel': 'Ada',
        'speakerStatus': 'resolved', 'chapterId': 'chapter-1',
    }]}
    return extraction, dialogue


@pytest.mark.parametrize(('word', 'action', 'expected'), [
    ('self-\nconfidence', 'keep-hyphen', 'self-confidence'),
    ('self-\nconfidence', 'join-word', 'selfconfidence'),
    ('confi-\ndence', 'join-word', 'confidence'),
    ('confi\u00ad \r\n  dence', 'keep-hyphen', 'confi-dence'),
])
def test_choices_preview_accept_and_record_without_changing_source_or_speaker(word, action, expected):
    extraction, dialogue = artifacts(word)
    original = deepcopy((extraction, dialogue))
    workspace = build_review_workspace(extraction, dialogue)
    warning, = workspace['warnings']
    row, = warning['occurrences']
    assert warning['kind'] == 'hyphenation'
    assert warning['decisionScope'] == 'occurrence'
    assert row['availableActions'] == ['keep-hyphen', 'join-word']
    assert row['hyphenChoices'][action] == expected
    preview = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1,
        occurrence_policies=[{'occurrenceId': row['id'], 'action': action}])
    review = accept_review_revision(workspace,
        [{'occurrenceIds': [row['id']], 'action': action}], revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert preview['spans'][0]['text'] == script['entries'][0]['text'] == f'I have {expected} today.'
    assert rendered['spans'][0]['resolvedSpeakerLabel'] == 'Ada'
    assert script['entries'][0]['sourceText'] == dialogue['spans'][0]['source']
    assert (extraction, dialogue) == original
    rendered['spans'][0]['text'] += ' invented'
    with pytest.raises(ReviewContractError):
        build_recording_script(rendered, review, {'revision': 'c1'}, revision='s2')


def test_model_cannot_replace_explicit_hyphen_choices_with_omission_or_join_suggestion():
    extraction, dialogue = artifacts('self-\nconfidence')
    workspace = build_review_workspace(extraction, dialogue)
    row = workspace['warnings'][0]['occurrences'][0]
    for replacement in ('selfconfidence', '', None):
        result = add_cleanup_proposals(workspace, extraction, dialogue, {'occurrences': [{
            key: row[key] for key in ('blockId', 'sourceStart', 'sourceEnd', 'source')
        } | {'replacement': replacement}]})
        assert result['warnings'] == workspace['warnings']
    for action in ('exclude', 'narrate', 'repair', 'keep'):
        with pytest.raises(ReviewContractError, match='not supported'):
            accept_review_revision(workspace, [{'occurrenceIds': [row['id']], 'action': action}], revision='r1')
    with pytest.raises(ReviewContractError, match='explicit decisions'):
        accept_review_revision(workspace, [], revision='r1')


def test_cross_speaker_word_is_not_offered_as_one_repair():
    extraction, dialogue = artifacts('self-\nconfidence')
    text = extraction['blocks'][0]['text']
    cut = text.index('\n') + 1
    original = dialogue['spans'][0]
    dialogue['spans'] = [{**original, 'id': str(i), 'sourceStart': left, 'sourceEnd': right,
                          'source': text[left:right], 'text': text[left:right]}
                         for i, (left, right) in enumerate(((0, cut), (cut, len(text))))]
    assert not build_review_workspace(extraction, dialogue)['warnings']


@pytest.mark.parametrize('action,spelling', [('keep-hyphen', 'self-confidence'), ('join-word', 'selfconfidence')])
@pytest.mark.parametrize('cue_action', ['keep', 'exclude'])
def test_hyphen_repair_and_verified_cue_share_a_span(action, spelling, cue_action):
    from tests.backend.test_script_direction_review import fixture
    extraction, dialogue, workspace, _ = fixture(('MARA: (softly) I have self-\nconfidence.',))
    choices = [{'occurrenceIds': [row['id']],
                'action': action if group['kind'] == 'hyphenation' else cue_action}
               for group in workspace['warnings'] for row in group['occurrences']]
    review = accept_review_revision(workspace, choices, revision='r1')
    preview = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1,
        occurrence_policies=[{'occurrenceId': choice['occurrenceIds'][0], 'action': choice['action']}
                             for choice in choices])
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    spoken = ''.join(entry['text'] for entry in script['entries'])
    assert spelling in spoken
    assert ('(softly)' in spoken) == (cue_action == 'keep')
    assert any(spelling in span['text'] and span['kind'] != 'excluded' for span in preview['spans'])
    tampered = deepcopy(rendered)
    repaired = next(span for span in tampered['spans'] if span.get('reviewRepairs'))
    repaired['text'] += ' invented'
    with pytest.raises(ReviewContractError):
        build_recording_script(tampered, review, {'revision': 'c1'}, revision='s2')
    repaired.pop('reviewRepairs')
    with pytest.raises(ReviewContractError):
        build_recording_script(tampered, review, {'revision': 'c1'}, revision='s3')
