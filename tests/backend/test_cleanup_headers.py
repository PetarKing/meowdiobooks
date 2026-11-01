from copy import deepcopy

import pytest

from meowdiobooks.backend.cleanup_headers import header_manifest, proposals, validate_headers, POLICY


def artifacts(n=8):
    blocks = [{"id": str(i), "page": i, "text": f"The Secret Garden\nA different sentence follows on page {i}."}
              for i in range(1, n + 1)]
    return {"method": "native", "blocks": blocks}, {"spans": [
        {"blockId": b["id"], "renderRole": "narration", "sourceStart": 0,
         "sourceEnd": len(b["text"]), "source": b["text"]} for b in blocks]}


def evidence(extraction, dialogue, chapter=None):
    families = header_manifest(extraction, dialogue, chapter or {})
    proofs, rows = [], []
    for family in families:
        screen = {"answers": [{"name": "family", "type": "choice", "choice": "HEADER"}]}
        response = {"assessments": [{"windowId": r["windowId"], "role": "HEADER"}
                                    for r in family["representatives"]], "reason": "Printed running title."}
        proofs.append({"id": family["id"], "screen": screen, "verification": response})
        rows.extend(proposals(family, screen, response))
    return {"policy": POLICY, "families": families, "proofs": proofs, "occurrences": rows}


@pytest.mark.parametrize("method", ["native", "layout", "liteparse", "ocr"])
def test_exact_family_keeps_first_and_uses_bounded_examples(method):
    extraction, dialogue = artifacts(40)
    extraction["method"] = method
    result = evidence(extraction, dialogue)
    assert len(result["families"]) == 1
    assert len(result["families"][0]["representatives"]) == 3
    assert len(result["occurrences"]) > 20
    assert "1" not in {r["blockId"] for r in result["occurrences"]}
    assert validate_headers(extraction, dialogue, {}, result) == result["occurrences"]
    assert all(r["source"] == "The Secret Garden" and r["replacement"] == "" for r in result["occurrences"])


def test_confirmed_chapter_boundary_and_cross_reader_preserved():
    extraction, dialogue = artifacts()
    chapter = {"boundaryCandidates": [{"blockId": "4", "sourceStart": 0, "sourceEnd": 17}]}
    dialogue["spans"][4]["renderRole"] = "dialogue"
    result = evidence(extraction, dialogue, chapter)
    assert not {"1", "4", "5"} & {r["blockId"] for r in result["occurrences"]}


def test_logical_pages_inline_labels_and_duplicate_pages_ineligible():
    extraction, dialogue = artifacts()
    extraction["method"] = "text"
    assert not header_manifest(extraction, dialogue, {})
    extraction["method"] = "native"
    for block in extraction["blocks"]:
        block["page"] = 1
    assert not header_manifest(extraction, dialogue, {})
    extraction, dialogue = artifacts()
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        block["text"] = "Different prose " + block["id"] + ".\nThe Secret Garden"
        span.update(source=block["text"], sourceEnd=len(block["text"]))
    assert not header_manifest(extraction, dialogue, {})


@pytest.mark.parametrize("mutation", ["uncertain", "missing", "source", "first", "owner"])
def test_proof_or_anchor_tampering_fails_closed(mutation):
    extraction, dialogue = artifacts()
    result = evidence(extraction, dialogue)
    assert result["occurrences"]
    if mutation == "uncertain":
        result["proofs"][0]["verification"]["assessments"][0]["role"] = "UNCERTAIN"
    elif mutation == "missing":
        result["proofs"][0]["verification"]["assessments"].pop()
    elif mutation == "source":
        result["occurrences"][0]["source"] += "more"
    elif mutation == "first":
        row = deepcopy(result["occurrences"][0])
        row.update(result["families"][0]["members"][0])
        result["occurrences"].append(row)
    else:
        dialogue["spans"][3]["source"] = "forged"
    with pytest.raises(ValueError):
        validate_headers(extraction, dialogue, {}, result)


@pytest.mark.parametrize("role", ["PRESERVE", "UNCERTAIN"])
def test_authored_refrain_or_contents_context_veto_preserves_family(role):
    extraction, dialogue = artifacts()
    result = evidence(extraction, dialogue)
    family, proof = result["families"][0], result["proofs"][0]
    proof["verification"]["assessments"][0]["role"] = role
    assert proposals(family, proof["screen"], proof["verification"]) == []


@pytest.mark.parametrize("padding", ["", "    "])
def test_pipeline_uses_two_family_calls_and_admission_preserves_evidence(monkeypatch, padding):
    import json
    from pathlib import Path
    from meowdiobooks.backend import cleanup_remote as cleanup
    from meowdiobooks.backend.review import build_review_workspace, add_cleanup_proposals, accept_review_revision
    extraction, dialogue = artifacts(20)
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        block["text"] = padding + block["text"]
        span.update(source=block["text"], sourceEnd=len(block["text"]))
    extraction["revision"] = "e1"
    dialogue.update(revision="d1", extractionRevision="e1")
    for span, block in zip(dialogue["spans"], extraction["blocks"]):
        span.update(id=block["id"], text=span["source"], page=block["page"])
    calls = []
    def decide(_root, _config, packet, questions, **kwargs):
        calls.append(questions[0]["name"])
        if questions[0]["name"] == "family":
            return {"answers": [{"name": "family", "type": "choice", "choice": "HEADER"}]}
        return {"answers": [{"name": n, "type": "choice", "choice": "clean"} for n in ("production", "word_damage")]}
    def complete(_root, _config, _system, packet, **kwargs):
        calls.append("verify")
        return {"text": json.dumps({"reason": "Running title.", "assessments": [
            {"windowId": r["windowId"], "role": "HEADER"} for r in json.loads(packet)["examples"]]})}
    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", complete)
    result = cleanup.run_cleanup_review(Path(__file__).resolve().parents[2], extraction, dialogue, lambda *args: None)
    assert calls.count("family") == 1 and calls.count("verify") == 1
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    assert workspace["runningHeaderReviewEvidence"] == result["runningHeaderReview"]
    decisions = [{"occurrenceIds": [r["id"]], "action": "keep"}
                 for warning in workspace["warnings"] for r in warning["occurrences"]]
    accepted = accept_review_revision(workspace, decisions, revision="r1")
    assert accepted["runningHeaderReviewEvidence"] == result["runningHeaderReview"]
    from meowdiobooks.backend.review import apply_review_render_policies
    omitted = accept_review_revision(workspace, [{**row, "action": "exclude"} for row in decisions], revision="r2")
    rendered = apply_review_render_policies(dialogue, omitted)
    assert rendered["spans"][0]["text"].lstrip().startswith("The Secret Garden")
    for block in extraction["blocks"]:
        parts = [span for span in rendered["spans"] if span["blockId"] == block["id"]]
        assert "A different sentence" in "".join(span["text"] for span in parts)
        assert "".join(span["source"] for span in parts) == block["text"]
    forged = deepcopy(result)
    forged["occurrences"][0]["sourceStart"] += 1
    with pytest.raises(ValueError):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, forged)


def test_overlapping_reader_ownership_preserves_source():
    extraction, dialogue = artifacts()
    dialogue["spans"].append({**dialogue["spans"][3], "renderRole": "dialogue"})
    result = evidence(extraction, dialogue)
    assert "4" not in {r["blockId"] for r in result["occurrences"]}


@pytest.mark.parametrize("role", ["chapter", "section", "contents", "uncertain", None])
def test_structural_candidate_with_protected_or_missing_chapter_role_is_retained(monkeypatch, role):
    from meowdiobooks.backend import cleanup_headers
    extraction, dialogue = artifacts()
    draft = {"id": "boundary:4:0-17", "blockId": "4", "sourceStart": 0, "sourceEnd": 17}
    monkeypatch.setattr(cleanup_headers, "detect_chapter_candidates", lambda blocks: [draft])
    chapter = {"assessments": [] if role is None else [{"boundaryId": draft["id"], "role": role}]}
    result = evidence(extraction, dialogue, chapter)
    assert "4" not in {r["blockId"] for r in result["occurrences"]}
