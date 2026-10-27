"""Isolated footnotes must not split a word owned by spelling Review."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, apply_review_render_policies,
    build_review_workspace, preview_review_transcript_page,
)


def artifacts(text):
    extraction = {'revision': 'e1', 'blocks': [{'id': 'b', 'page': 1, 'text': text}]}
    dialogue = {'revision': 'd1', 'extractionRevision': 'e1', 'spans': [{
        'id': 's', 'blockId': 'b', 'page': 1, 'sourceStart': 0, 'sourceEnd': len(text),
        'source': text, 'text': text, 'renderRole': 'narration', 'chapterId': 'chapter-1',
    }]}
    return extraction, dialogue


@pytest.mark.parametrize('word', ['stud-\n ied', 'stud\u00ad\nied', 'stud- \r\n\tied'])
@pytest.mark.parametrize('following', ['Story resumes.', 'ordinary prose resumes.'])
@pytest.mark.parametrize('action', ['join-word', 'keep-hyphen'])
def test_isolated_note_owns_wrapped_word_through_preview_and_recording(word, following, action):
    note = f'[4] A scholar {word} the records.'
    text = f'{note}\n{following}'
    extraction, dialogue = artifacts(text)
    workspace = build_review_workspace(extraction, dialogue)
    before = deepcopy((extraction, dialogue, workspace))
    footnotes = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')
    occurrence, = footnotes['occurrences']
    assert occurrence['source'] == note
    assert text[occurrence['sourceStart']:occurrence['sourceEnd']] == note
    choices = [{'occurrenceIds': [row['id']],
                'action': action if warning['kind'] == 'hyphenation' else 'exclude'}
               for warning in workspace['warnings'] for row in warning['occurrences']]
    preview = preview_review_transcript_page(extraction, dialogue, workspace,
        [{'warningId': footnotes['id'], 'action': 'exclude'}], page=1,
        occurrence_policies=[{'occurrenceId': choice['occurrenceIds'][0], 'action': action}
                             for choice in choices if choice['action'] != 'exclude'])
    review = accept_review_revision(workspace, choices, revision='r1')
    rendered = apply_review_render_policies(dialogue, review)
    script = build_recording_script(rendered, review, {'revision': 'c1'}, revision='s1')
    assert ''.join(row['source'] for row in rendered['spans']) == text
    assert [row['text'] for row in preview['spans'] if row['kind'] != 'excluded'] == [following]
    assert ''.join(row['text'] for row in script['entries'] if row['kind'] != 'omission').strip() == following
    assert (extraction, dialogue, workspace) == before


@pytest.mark.parametrize('tail', [
    '\n\nied the records.', '\n \nied the records.', '\nIed the records.',
    '\n[5] Another note.', '\nChapter 2', '\nchapter 2', '\n译者注：', '\nappendix:',
])
def test_isolated_note_does_not_cross_structural_or_ambiguous_break(tail):
    text = '[4] A scholar stud-' + tail
    extraction, dialogue = artifacts(text)
    workspace = build_review_workspace(extraction, dialogue)
    footnote = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')
    assert footnote['occurrences'][0]['source'] == '[4] A scholar stud-'


def test_complete_note_does_not_capture_indented_lowercase_prose():
    extraction, dialogue = artifacts('[4] A complete note.\n    ordinary prose resumes.')
    workspace = build_review_workspace(extraction, dialogue)
    note = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')['occurrences'][0]
    assert note['source'] == '[4] A complete note.'


def test_chained_wrapped_note_stops_before_ordinary_prose():
    note = '[4] A scholar stud-\nied the rec-\nords.'
    extraction, dialogue = artifacts(note + '\nordinary prose resumes.')
    workspace = build_review_workspace(extraction, dialogue)
    occurrence, = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')['occurrences']
    assert occurrence['source'] == note
    assert occurrence['sourceEnd'] == len(note)


def test_saved_partial_overlap_still_rejects_without_mutation_and_can_be_revised():
    text = '[4] A scholar stud-\n ied the records.\nStory resumes.'
    extraction, dialogue = artifacts(text)
    workspace = build_review_workspace(extraction, dialogue)
    # Synthetic saved candidate with the historical one-line note and AI repair.
    note = next(w for w in workspace['warnings'] if w['kind'] == 'footnote')['occurrences'][0]
    note.update(id=f"review:footnote:b:0-{text.index(chr(10))}",
                sourceEnd=text.index('\n'), source=text.split('\n')[0])
    group = next(w for w in workspace['warnings'] if w['kind'] == 'hyphenation')
    group.update(id='review:ai-cleanup', kind='ai-cleanup', availableActions=['keep', 'repair'])
    repair, = group['occurrences']
    repair.update(id=f"review:ai-cleanup:b:{repair['sourceStart']}-{repair['sourceEnd']}",
                  warningId=group['id'], kind='ai-cleanup', availableActions=['keep', 'repair'],
                  proposalStatus='proposed', replacement='studied')
    repair.pop('hyphenChoices', None)
    before = deepcopy((workspace, dialogue))
    review = {'warningSnapshot': workspace['warnings'], 'decisions': [
        {'occurrenceId': note['id'], 'action': 'exclude'},
        {'occurrenceId': repair['id'], 'action': 'repair'},
    ]}
    with pytest.raises(ReviewContractError, match='crosses another review decision'):
        apply_review_render_policies(dialogue, review)
    review['decisions'][1]['action'] = 'keep'
    result = apply_review_render_policies(dialogue, review)
    assert ''.join(row['source'] for row in result['spans']) == text
    assert (workspace, dialogue) == before
