"""Public synthetic checks for real-book cleanup failure categories."""

import copy
import json
from pathlib import Path

import pytest

from meowdiobooks.backend.review import (
    accept_review_revision,
    apply_review_render_policies,
    build_review_workspace,
    preview_bulk_decision,
)


CASES = json.loads(
    (Path(__file__).parents[1] / "fixtures" / "cleanup_review_cases.json").read_text()
)["cases"]


def _artifacts(case):
    blocks = copy.deepcopy(case["blocks"])
    extraction = {"revision": "source-1", "blocks": blocks}
    dialogue = {
        "revision": "dialogue-1",
        "extractionRevision": "source-1",
        "spans": [
            {
                "id": f"span:{block['id']}",
                "blockId": block["id"],
                "sourceStart": 0,
                "sourceEnd": len(block["text"]),
                "spokenStart": 0,
                "spokenEnd": len(block["text"]),
                "source": block["text"],
                "text": block["text"],
                "renderRole": "dialogue" if case.get("dialogue") else "narration",
            }
            for block in blocks
        ],
    }
    return extraction, dialogue


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_cleanup_evidence_and_keep_policy_preserve_source(case):
    extraction, dialogue = _artifacts(case)
    original = copy.deepcopy((extraction, dialogue))
    workspace = build_review_workspace(extraction, dialogue)
    occurrences = [row for warning in workspace["warnings"] for row in warning["occurrences"]]
    assert sorted((row["kind"], row["source"]) for row in occurrences) == sorted(
        (row["kind"], row["source"]) for row in case["expected"]
    )
    assert workspace["sourceReconstruction"]["status"] == "exact"
    by_id = {row["id"]: row["text"] for row in extraction["blocks"]}
    for row in occurrences:
        assert by_id[row["blockId"]][row["sourceStart"]:row["sourceEnd"]] == row["source"]
    accepted = accept_review_revision(
        workspace,
        [{"occurrenceIds": [row["id"]], "action": "keep"} for row in occurrences],
        revision="keep-1",
    )
    rendered = apply_review_render_policies(dialogue, accepted)
    assert "".join(row["source"] for row in rendered["spans"]) == "".join(by_id.values())
    assert "".join(row["text"] for row in rendered["spans"]) == "".join(by_id.values())
    assert (extraction, dialogue) == original


def test_numbered_footer_detection_does_not_make_different_evidence_bulk_identical():
    case = next(case for case in CASES if case["id"] == "numbered-brand-footer")
    workspace = build_review_workspace(*_artifacts(case))
    occurrences = workspace["warnings"][0]["occurrences"]
    preview = preview_bulk_decision(workspace, occurrences[0]["id"], "exclude")
    assert preview["affectedCount"] == 1
    assert occurrences[0]["matchKey"] != occurrences[1]["matchKey"]


def test_explicit_credit_exclusion_removes_names_but_preserves_story_and_source():
    case = next(case for case in CASES if case["id"] == "credit-paragraph")
    extraction, dialogue = _artifacts(case)
    workspace = build_review_workspace(extraction, dialogue)
    credit = workspace["warnings"][0]["occurrences"][0]
    assert credit["detectionRule"] == "production-credit-block"
    accepted = accept_review_revision(
        workspace, [{"occurrenceIds": [credit["id"]], "action": "exclude"}], revision="exclude-1"
    )
    rendered = apply_review_render_policies(dialogue, accepted)
    assert "".join(row["source"] for row in rendered["spans"]) == extraction["blocks"][0]["text"]
    spoken = "".join(
        row["text"] for row in rendered["spans"] if row.get("reviewAction") != "exclude"
    )
    assert spoken.strip() == "The door opened."


def test_credit_continuation_stops_before_an_attributed_dialogue_line():
    text = "Translated By:\nAda Reed\nRun"
    extraction, dialogue = _artifacts({"blocks": [{"id": "b0", "page": 1, "text": text}]})
    boundary = text.index("Run")
    template = dialogue["spans"][0]
    dialogue["spans"] = [
        {
            **template, "id": "narration", "sourceEnd": boundary, "spokenEnd": boundary,
            "source": text[:boundary], "text": text[:boundary],
        },
        {
            **template, "id": "speech", "sourceStart": boundary, "spokenStart": boundary,
            "source": text[boundary:], "text": text[boundary:], "renderRole": "dialogue",
        },
    ]
    workspace = build_review_workspace(extraction, dialogue)
    credit = next(
        row for warning in workspace["warnings"] for row in warning["occurrences"]
        if row.get("detectionRule") == "production-credit-block"
    )
    assert credit["source"] == "Translated By:\nAda Reed"
    accepted = accept_review_revision(
        workspace, [{"occurrenceIds": [credit["id"]], "action": "exclude"}], revision="exclude-1"
    )
    rendered = apply_review_render_policies(dialogue, accepted)
    assert "".join(row["source"] for row in rendered["spans"]) == text
    assert "".join(
        row["text"] for row in rendered["spans"] if row.get("reviewAction") != "exclude"
    ).strip() == "Run"
