"""Page previews retain correction context without rendering unrelated book pages."""
from copy import deepcopy
from pathlib import Path

import pytest
from pypdf import PdfReader

from meowdiobooks.backend import review as rv
from meowdiobooks.backend import review_resolution as resolution
from test_boundary_review import artifacts as boundary_artifacts, mock_model, review
from meowdiobooks.backend.boundary_review import boundary_cleanup_rows


def artifacts(texts):
    extraction, dialogue = boundary_artifacts(texts)
    extraction["revision"] = "e1"
    dialogue.update(revision="d1", extractionRevision="e1")
    return extraction, dialogue


def preview_pair(monkeypatch, extraction, dialogue, workspace, policies, occurrences, page):
    original = deepcopy((extraction, dialogue, workspace))
    scoped = rv.preview_review_transcript_page(extraction, dialogue, workspace, policies,
                                              page=page, occurrence_policies=occurrences)
    with monkeypatch.context() as full:
        full.setattr(rv, '_transcript_preview_context', lambda d, r, *_: (d, r, None))
        baseline = rv.preview_review_transcript_page(extraction, dialogue, workspace, policies,
                                                    page=page, occurrence_policies=occurrences)
    assert scoped == baseline
    assert (extraction, dialogue, workspace) == original
    return scoped


def test_large_book_renders_only_selected_page(monkeypatch):
    extraction, dialogue = artifacts(tuple(f'Page {i}. A complete sentence.' for i in range(600)))
    workspace = {'warnings': []}
    counts = []
    resolve = resolution.resolve_review_revision

    def capture(scoped, requested, **kwargs):
        counts.append(len(scoped['spans']))
        return resolve(scoped, requested, **kwargs)

    monkeypatch.setattr(resolution, 'resolve_review_revision', capture)
    with monkeypatch.context() as full:
        full.setattr(rv, '_transcript_preview_context', lambda d, r, *_: (d, r, None))
        baseline = rv.preview_review_transcript_page(extraction, dialogue, workspace, [], page=543)
    result = rv.preview_review_transcript_page(extraction, dialogue, workspace, [], page=543)
    assert result == baseline
    assert counts == [600, 1]
    assert [span['text'] for span in result['spans']] == ['Page 542. A complete sentence.']
    assert result['pageCount'] == 600


def test_neighbor_kept_seam_protects_selected_page_from_broad_cleanup(monkeypatch):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts(('She shut her', 'eyes could look', 'blue.', 'Unrelated prose.'))
    evidence = review(extraction, dialogue)
    workspace = rv.add_cleanup_proposals(rv.build_review_workspace(extraction, dialogue), extraction,
        dialogue, {'boundaryReview': evidence,
                   'occurrences': boundary_cleanup_rows(evidence['occurrences']),
                   'unifiedSuggestions': True})
    generic = {'id': 'generic', 'kind': 'ai-cleanup', 'blockId': 'b1', 'page': 2,
               'sourceStart': 0, 'sourceEnd': 15, 'source': 'eyes could look',
               'replacement': 'eyes look', 'proposalStatus': 'proposed',
               'availableActions': ['keep', 'repair']}
    workspace['warnings'].append({'id': 'generic-group', 'kind': 'ai-cleanup',
                                  'decisionScope': 'occurrence', 'occurrences': [generic]})
    decisions = [{'occurrenceId': row['id'], 'action': 'repair' if row.get('page') == 1 or row['id'] == 'generic' else 'keep'}
                 for warning in workspace['warnings'] for row in warning['occurrences']]
    for page in range(1, 5):
        result = preview_pair(monkeypatch, extraction, dialogue, workspace, [], decisions, page)
        if page == 1:
            assert result['spans'][0]['text'] == 'She shut her eyes'


@pytest.mark.parametrize('action', ['exclude', 'narrate', 'keep'])
def test_disjoint_policy_on_auxiliary_anchor_span_matches_full_render(monkeypatch, action):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts(('She shut her', 'eyes note.'))
    evidence = review(extraction, dialogue)
    workspace = rv.add_cleanup_proposals(rv.build_review_workspace(extraction, dialogue), extraction,
        dialogue, {'boundaryReview': evidence, 'occurrences': boundary_cleanup_rows(evidence['occurrences']),
                   'unifiedSuggestions': True})
    workspace['warnings'].append({'id': 'note', 'kind': 'page-number', 'occurrences': [{
        'id': 'note-tail', 'kind': 'page-number', 'blockId': 'b1', 'page': 2,
        'sourceStart': 5, 'sourceEnd': 10, 'source': 'note.', 'availableActions': ['keep', 'exclude', 'narrate']}]})
    decisions = [{'occurrenceId': row['id'], 'action': 'repair'}
                 for warning in workspace['warnings'] if warning['id'] != 'note' for row in warning['occurrences']]
    preview_pair(monkeypatch, extraction, dialogue, workspace,
                 [{'warningId': 'note', 'action': action}], decisions, 1)


def test_boundary_evidence_subset_keeps_original_proof_and_question_identity(monkeypatch):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts(tuple(text for _ in range(24) for text in ('She shut her', 'eyes.')))
    evidence = review(extraction, dialogue)
    workspace = rv.add_cleanup_proposals(rv.build_review_workspace(extraction, dialogue), extraction,
        dialogue, {'boundaryReview': evidence, 'occurrences': boundary_cleanup_rows(evidence['occurrences']),
                   'unifiedSuggestions': True})
    decisions = [{'occurrenceId': row['id'], 'action': 'repair'}
                 for warning in workspace['warnings'] for row in warning['occurrences']]
    for page in (1, 22, 43, 48):
        preview_pair(monkeypatch, extraction, dialogue, workspace, [], decisions, page)


@pytest.mark.parametrize('filename', [
    '01-alice-explicit-dialogue.pdf', '02-pride-inferred-multispeaker.pdf',
    '03-ah-q-traditional-chinese-dialogue.pdf',
])
def test_public_domain_samples_match_full_preview(monkeypatch, filename):
    path = Path(__file__).resolve().parents[2] / 'SampleBooks' / 'public-domain-evaluation' / filename
    texts = tuple(page.extract_text() or '' for page in PdfReader(path).pages)
    extraction, dialogue = artifacts(texts)
    workspace = rv.build_review_workspace(extraction, dialogue)
    policies, occurrences = [], []
    for warning in workspace['warnings']:
        if warning.get('decisionScope') == 'occurrence' or warning['kind'] == 'ai-cleanup':
            occurrences.extend({'occurrenceId': row['id'], 'action': 'keep'} for row in warning['occurrences'])
        else:
            policies.append({'warningId': warning['id'], 'action': 'keep'})
    for page in range(1, len(texts) + 1):
        preview_pair(monkeypatch, extraction, dialogue, workspace, policies, occurrences, page)


def test_continuous_seams_do_not_pull_in_the_entire_book(monkeypatch):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts(tuple('first last' for _ in range(120)))
    evidence = review(extraction, dialogue)
    workspace = rv.add_cleanup_proposals(rv.build_review_workspace(extraction, dialogue), extraction,
        dialogue, {'boundaryReview': evidence, 'occurrences': boundary_cleanup_rows(evidence['occurrences']),
                   'unifiedSuggestions': True})
    decisions = [{'occurrenceId': row['id'], 'action': 'repair'}
                 for warning in workspace['warnings'] for row in warning['occurrences']]
    counts = []
    resolve = resolution.resolve_review_revision

    def capture(scoped, requested, **kwargs):
        counts.append(len(scoped['spans']))
        return resolve(scoped, requested, **kwargs)

    monkeypatch.setattr(resolution, 'resolve_review_revision', capture)
    preview_pair(monkeypatch, extraction, dialogue, workspace, [], decisions, 60)
    assert counts == [3, 120]


def test_legacy_note_extension_retains_preceding_page_context(monkeypatch):
    extraction, dialogue = artifacts(('Translation Notes:\n[1] A stud-', 'ied-\nwords.', 'Unrelated story.'))
    workspace = {'warnings': [{'id': 'notes', 'kind': 'footnote', 'occurrences': [{
        'id': 'old-note', 'kind': 'footnote', 'blockId': 'b1', 'page': 2,
        'sourceStart': 0, 'sourceEnd': 4, 'source': 'ied-', 'availableActions': ['keep', 'exclude']}]}]}
    result = preview_pair(monkeypatch, extraction, dialogue, workspace,
                          [{'warningId': 'notes', 'action': 'exclude'}], [], 2)
    assert [(row['kind'], row['text']) for row in result['spans']] == [('excluded', 'ied-\nwords.')]
