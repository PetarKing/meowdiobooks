"""Accepted cleanup changes speech while preserving immutable source and reader identity."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.dialogue import malformed_playable_spans
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals,
    apply_review_render_policies, build_review_workspace, preview_review_transcript_page,
)


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
    return [{'occurrenceIds': [row['id']], 'action': action if warning['kind'] == 'ai-cleanup' else 'keep'}
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
                if warning['kind'] != 'ai-cleanup']
    with pytest.raises(ReviewContractError, match='Every cleanup'):
        preview_review_transcript_page(extraction, dialogue, workspace, policies, page=1)
    ai = next(w for w in workspace['warnings'] if w['kind'] == 'ai-cleanup')['occurrences'][0]
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
    ai = next(w for w in workspace['warnings'] if w['kind'] == 'ai-cleanup')
    with pytest.raises(ReviewContractError, match='identical'):
        accept_review_revision(workspace, [{'occurrenceIds': [r['id'] for r in ai['occurrences']],
                                            'action': 'repair'}], revision='bad')
    review = accept_review_revision(workspace, decisions(workspace), revision='r1')
    assert apply_review_render_policies(dialogue, review)['spans'][0]['text'] == 'An broken sign.'
