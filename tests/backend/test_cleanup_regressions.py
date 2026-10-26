"""Public synthetic checks for real-book cleanup failure categories."""

import copy
import json
from pathlib import Path

import pytest

from meowdiobooks.backend.review import (
    accept_review_revision,
    apply_review_render_policies,
    build_review_workspace,
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



@pytest.mark.parametrize("source", [
    "She wondered if the\ncontents had been shared with her.",
    "Copyright was the subject of their discussion.",
    "Index the books before leaving, she said.",
    "Translated By:\nAda Reed\n\nThe door opened.",
    "Traduit par :\nCamille Martin\n\nLa porte s’ouvrit.",
    "翻訳：\n山田花子\n\n扉が開いた。",
])
def test_semantic_editorial_roles_are_not_inferred_from_words(source):
    extraction, dialogue = _artifacts({"blocks": [{"id": "b", "page": 1, "text": source}]})
    workspace = build_review_workspace(extraction, dialogue)
    assert not workspace["warnings"]
    accepted = accept_review_revision(workspace, [], revision="keep")
    rendered = apply_review_render_policies(dialogue, accepted)
    assert rendered["spans"][0]["text"] == source


@pytest.mark.parametrize("label", ["maison des livres", "青空文庫", "издательство", "دار الكتب"])
def test_numbered_edge_candidates_are_language_neutral_and_exact(label):
    from meowdiobooks.backend.review import numbered_edge_candidates
    blocks = [{"id": str(i), "page": i, "text": f"Unique prose {i}.\n{label} {i + 7}"}
              for i in range(1, 4)]
    rows = numbered_edge_candidates(blocks)
    assert len(rows) == 3
    for row, block in zip(rows, blocks):
        assert row["source"] == block["text"][row["sourceStart"]:row["sourceEnd"]]
        assert row["source"] == f"{label} {block['page'] + 7}"
    assert numbered_edge_candidates(blocks[:2]) == []


@pytest.mark.parametrize("mutation", ["offset", "body", "dialogue", "punctuation", "same_page"])
def test_numbered_edge_candidates_require_consistent_structural_evidence(mutation):
    from meowdiobooks.backend.review import numbered_edge_candidates
    blocks = [{"id": str(i), "page": i, "text": f"Unique prose {i}.\npetite maison {i + 7}"}
              for i in range(1, 4)]
    if mutation == "offset":
        blocks[-1]["text"] = "Unique prose.\npetite maison 99"
    elif mutation == "body":
        for block in blocks:
            block["text"] += "\nMore prose."
    elif mutation in {"dialogue", "punctuation"}:
        for block in blocks:
            block["text"] = block["text"].replace("petite maison", "“petite maison”" if mutation == "dialogue" else "petite maison:")
    else:
        for block in blocks:
            block["page"] = 1
    assert numbered_edge_candidates(blocks) == []
