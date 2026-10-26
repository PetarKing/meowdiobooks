"""Human evidence is contextual without widening any editable source anchor."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.review import build_review_workspace, add_cleanup_proposals
from meowdiobooks.backend.review_context import add_source_context


def artifacts(texts):
    blocks = [{'id': f'b{i}', 'page': i + 1, 'text': text} for i, text in enumerate(texts)]
    extraction = {'revision': 'e1', 'blocks': blocks}
    dialogue = {'revision': 'd1', 'extractionRevision': 'e1', 'spans': [
        {'id': f's{i}', 'blockId': b['id'], 'page': b['page'], 'sourceStart': 0,
         'sourceEnd': len(b['text']), 'source': b['text'], 'renderRole': 'narration'}
        for i, b in enumerate(blocks)]}
    return extraction, dialogue


def test_label_and_whitespace_do_not_hide_neighboring_prose():
    extraction, _ = artifacts(['The door was locked. She turned to her brother.',
                               'MARA: [said softly] Stay close.   ', '   ',
                               'He nodded and took her hand.'])
    cue = {'blockId': 'b1', 'sourceStart': 6, 'sourceEnd': 19,
           'source': '[said softly]', 'id': 'unchanged'}
    original = deepcopy(cue)
    add_source_context([cue], extraction['blocks'])
    assert cue['contextLayout'] == 'continuous'
    assert cue['contextBefore'] == 'The door was locked. She turned to her brother.\n\nMARA: '
    assert 'Stay close.' in cue['contextAfter']
    assert cue['contextAfter'].endswith('He nodded and took her hand.')
    assert {key: cue[key] for key in original} == original


def test_long_sentences_are_complete_and_oversized_ones_explicitly_clipped():
    sentence = 'She remembered ' + 'the quiet house and the garden ' * 8 + 'before leaving.'
    text = sentence + '\n[softly]\n' + sentence
    start = text.index('[softly]')
    row = {'blockId': 'b', 'sourceStart': start, 'sourceEnd': start + 8}
    add_source_context([row], [{'id': 'b', 'text': text}])
    assert row['contextBefore'].strip() == sentence
    assert row['contextAfter'].strip() == sentence
    text = 'unbroken ' * 200 + '[softly]' + ' unbroken' * 200
    start = text.index('[softly]')
    row.update(sourceStart=start, sourceEnd=start + 8)
    add_source_context([row], [{'id': 'b', 'text': text}])
    assert row['contextBefore'].startswith('… ')
    assert row['contextAfter'].endswith(' …')
    assert max(len(row['contextBefore']), len(row['contextAfter'])) <= 602


def test_chinese_sentence_boundaries_and_document_edges():
    sentence = '他沿著寂靜的小路走向遠處的房屋' * 12 + '。'
    row = {'blockId': 'b', 'sourceStart': 0, 'sourceEnd': 4}
    add_source_context([row], [{'id': 'b', 'text': '[低聲]' + sentence + '下一句。' * 100}])
    assert row['contextBefore'] == ''
    assert row['contextAfter'] == sentence
    row.update(sourceStart=4, sourceEnd=4 + len(sentence))
    add_source_context([row], [{'id': 'b', 'text': '[低聲]' + sentence}])
    assert row['contextAfter'] == ''


@pytest.mark.parametrize('replacement', ['broken', None])
def test_deterministic_and_ai_review_share_source_context(replacement):
    extraction, dialogue = artifacts(['They stopped beside the old house.', 'A bro-\nken sign.',
                                      'The faded letters were almost impossible to read.'])
    workspace = build_review_workspace(extraction, dialogue)
    original = deepcopy((extraction, dialogue))
    rows = [row for warning in workspace['warnings'] for row in warning['occurrences']]
    assert rows
    for row in rows:
        assert 'They stopped beside the old house.' in row['contextBefore']
        assert 'The faded letters were almost impossible to read.' in row['contextAfter']
    proposal = {'blockId': 'b1', 'sourceStart': 2, 'sourceEnd': 10, 'source': 'bro-\nken',
                'replacement': replacement}
    result = add_cleanup_proposals(workspace, extraction, dialogue, {'occurrences': [proposal]})
    proposed = [row for warning in result['warnings'] for row in warning['occurrences']
                if row.get('kind') == 'hyphenation']
    assert proposed
    assert all(not row.get('proposalStatus') for row in proposed)
    for row in proposed:
        assert 'They stopped beside the old house.' in row['contextBefore']
        assert 'The faded letters were almost impossible to read.' in row['contextAfter']
    assert (extraction, dialogue) == original


def test_saved_chapter_candidates_gain_context_without_changing_identity():
    extraction, dialogue = artifacts(['The last visitor left.', 'CHAPTER II', 'Morning came at last.'])
    boundary = {'id': 'chapter2', 'blockId': 'b1', 'page': 2, 'sourceStart': 0,
                'sourceEnd': 10, 'source': 'CHAPTER II'}
    extraction['boundaryCandidates'] = [boundary]
    result = build_review_workspace(extraction, dialogue)['boundaryCandidates'][0]
    assert result['contextBefore'].strip() == 'The last visitor left.'
    assert result['contextAfter'].strip() == 'Morning came at last.'
    assert {key: result[key] for key in boundary} == boundary
    assert 'contextBefore' not in boundary


def test_unanchored_legacy_context_is_not_claimed_to_be_continuous():
    row = {'source': 'CHAPTER II', 'contextBefore': 'The visitor left.',
           'contextAfter': 'Morning came.'}
    original = deepcopy(row)
    add_source_context([row], [{'id': 'b', 'text': 'CHAPTER II'}])
    assert row == original
