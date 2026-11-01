"""Saved empty-page warnings preserve source without requiring a retired UI choice."""
from copy import deepcopy

import pytest

from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, apply_review_render_policies,
    build_review_workspace, preview_review_transcript_page, review_progression_blockers,
)


def saved_candidate(*, occurrence_scope=False, malformed=False):
    extraction = {"revision": "e1", "blocks": [
        {"id": "p1", "page": 1, "text": "The original story remains intact."},
        {"id": "p2", "page": 2, "text": ""},
    ]}
    dialogue = {"revision": "d1", "extractionRevision": "e1", "spans": [
        {"id": f"span-{block['id']}", "blockId": block["id"], "page": block["page"],
         "sourceStart": 0, "sourceEnd": len(block["text"]), "spokenStart": 0,
         "spokenEnd": len(block["text"]), "source": block["text"], "text": block["text"],
         "renderRole": "narration"}
        for block in extraction["blocks"]
    ]}
    if malformed:
        dialogue["spans"][0].update(sourceEnd=3, spokenEnd=3, source="The", text="The")
    workspace = build_review_workspace(extraction, dialogue)
    assert not any(row["kind"] == "empty-page" for row in workspace["warnings"])
    warning = {"id": "review:empty-page", "kind": "empty-page", "severity": "blocking",
               "availableActions": ["keep", "rerun-extraction"], "occurrences": [{
                   "id": "review:empty-page:p2:0-0", "warningId": "review:empty-page",
                   "blockId": "p2", "page": 2, "sourceStart": 0, "sourceEnd": 0,
                   "source": "", "text": "", "kind": "empty-page", "severity": "blocking",
                   "availableActions": ["keep", "rerun-extraction"], "matchKey": "empty",
               }]}
    if occurrence_scope:
        warning["decisionScope"] = "occurrence"
    workspace["warnings"].append(warning)
    return extraction, dialogue, workspace


@pytest.mark.parametrize("occurrence_scope", [False, True])
def test_saved_empty_page_requires_no_decision_for_acceptance_or_transcript_preview(occurrence_scope):
    extraction, dialogue, workspace = saved_candidate(occurrence_scope=occurrence_scope)
    before = deepcopy((extraction, dialogue, workspace))
    accepted = accept_review_revision(workspace, [], revision="r2")
    assert accepted["canStartCast"] is True
    assert accepted["requiresNewUpstreamRevision"] is False
    assert review_progression_blockers(accepted) == []
    assert accepted["decisions"] == [{
        "occurrenceId": "review:empty-page:p2:0-0", "warningId": "review:empty-page",
        "action": "keep", "provenance": "preserve-empty-page",
        "consequence": {"sourcePreserved": True, "downstreamInvalidation": [],
                        "affectedOccurrences": 1, "audio": "unchanged",
                        "requiresNewUpstreamRevision": False},
    }]
    preview = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1)
    assert "".join(row["text"] for row in preview["spans"]) == extraction["blocks"][0]["text"]
    empty = preview_review_transcript_page(extraction, dialogue, workspace, [], page=2)
    assert empty["spans"] == []
    rendered = apply_review_render_policies(dialogue, accepted)
    assert "".join(row["source"] for row in rendered["spans"]) == "".join(
        row["text"] for row in extraction["blocks"])
    assert (extraction, dialogue, workspace) == before


def test_explicit_old_empty_page_choice_is_not_overwritten_by_default():
    _extraction, _dialogue, workspace = saved_candidate()
    accepted = accept_review_revision(workspace, [{
        "occurrenceIds": ["review:empty-page:p2:0-0"], "action": "rerun-extraction",
    }], revision="r2")
    assert accepted["decisions"][0]["action"] == "rerun-extraction"
    assert accepted["decisions"][0]["provenance"] == "user"
    assert accepted["requiresNewUpstreamRevision"] is True
    assert accepted["canStartCast"] is False


def test_source_coverage_mismatch_still_blocks_cast_after_retired_warning_is_preserved():
    _extraction, _dialogue, workspace = saved_candidate(malformed=True)
    assert workspace["sourceReconstruction"]["status"] == "failed"
    accepted = accept_review_revision(workspace, [], revision="r2")
    assert accepted["canStartCast"] is False
    assert "Restore exact Extraction-to-Dialogue source coverage" in review_progression_blockers(accepted)
    assert accepted["decisions"][0]["provenance"] == "preserve-empty-page"


def test_retiring_empty_page_does_not_default_other_review_choices():
    _extraction, _dialogue, workspace = saved_candidate()
    workspace["warnings"].append({"id": "other", "kind": "reading-order", "occurrences": [{
        "id": "reading-order:p1", "warningId": "other", "kind": "reading-order",
        "availableActions": ["keep", "rerun-extraction"],
    }]})
    with pytest.raises(ReviewContractError, match="reading-order:p1"):
        accept_review_revision(workspace, [], revision="r2")
