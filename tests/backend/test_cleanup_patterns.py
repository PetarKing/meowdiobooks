"""Repeated matter needs individual contextual eligibility and bounded group confirmation."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from meowdiobooks.backend import cleanup_remote as cleanup
from meowdiobooks.backend.cleanup_patterns import pattern_verdict
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals, apply_review_render_policies,
    build_review_workspace, numbered_edge_candidates, preview_review_transcript_page,
)

ROOT = Path(__file__).resolve().parents[2]


def artifacts(n=9, label="青空文庫"):
    blocks = [{"id": str(i), "page": i, "text": f"Unique story sentence {i}.\n{label} {i + 7}"}
              for i in range(1, n + 1)]
    return ({"revision": "e1", "blocks": blocks}, {"revision": "d1", "extractionRevision": "e1", "spans": [
        {"id": b["id"], "blockId": b["id"], "sourceStart": 0, "sourceEnd": len(b["text"]),
         "source": b["text"], "text": b["text"], "page": b["page"], "renderRole": "narration"}
        for b in blocks]})


def answers(production="clean", word="clean"):
    return {"answers": [{"name": name, "type": "choice", "choice": choice} for name, choice in (
        ("production", production), ("word_damage", word))]}


def mocks(monkeypatch, *, verdict="FOOTER", veto=None, damage=None):
    calls = {"decisions": [], "repair": [], "verification": []}

    def decide(_root, _config, prompt, _questions, **_kwargs):
        packet = json.loads(prompt)
        calls["decisions"].append(packet)
        if "structural_evidence" not in packet:
            return answers()
        if packet["TARGET"] == veto:
            return answers("uncertain")
        if packet["TARGET"] == damage:
            return answers("review", "uncertain")
        return answers("review")

    def complete(_root, _config, _system, prompt, **_kwargs):
        packet = json.loads(prompt)
        if "examples" in packet:
            calls["verification"].append(packet)
            return {"text": json.dumps({"assessments": [
                {"windowId": row["windowId"], "role": verdict} for row in packet["examples"]
            ], "reason": "Assessed each exact source example."})}
        calls["repair"].append(packet)
        return {"text": json.dumps({"action": "source_review", "edits": [], "reason": "Uncertain damage."})}

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", complete)
    return calls


def test_large_family_needs_one_verifier_and_keeps_distinct_source_choices(monkeypatch):
    extraction, dialogue = artifacts(30)
    original = deepcopy((extraction, dialogue))
    calls = mocks(monkeypatch)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert len(calls["decisions"]) == 60
    assert len(calls["verification"]) == 1 and calls["repair"] == []
    representatives = calls["verification"][0]["examples"]
    assert [row["TARGET"] for row in representatives] == ["青空文庫 8", "青空文庫 23", "青空文庫 37"]
    assert all(row["TARGET"].startswith("青空文庫") and "Unique story" not in row["TARGET"]
               for row in representatives)
    assert len(result["occurrences"]) == 30
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    group, = workspace["warnings"]
    assert group["patternVerification"] == "verified" and group["decisionScope"] == "occurrence"
    assert len({r["matchKey"] for r in group["occurrences"]}) == 30
    decisions = [{"occurrenceIds": [r["id"]], "action": "keep" if i == 2 else "repair"}
                 for i, r in enumerate(group["occurrences"])]
    accepted = accept_review_revision(workspace, decisions, revision="r1")
    rendered = apply_review_render_policies(dialogue, accepted)
    assert rendered["spans"][2]["text"].endswith("青空文庫 10")
    assert all("青空文庫" not in r["text"] for i, r in enumerate(rendered["spans"]) if i != 2)
    assert "".join(r["source"] for r in rendered["spans"]) == "".join(b["text"] for b in extraction["blocks"])
    assert (extraction, dialogue) == original
    evidence = accepted["cleanupPatternEvidence"]
    assert evidence == workspace["cleanupPatternEvidence"]
    assert evidence["groups"] == result["patternGroups"]
    assert len(evidence["windows"]) == 30  # Unrelated body scan is not duplicated.
    assert all(row.get("patternGroupId") for row in evidence["windows"])
    preview = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1,
        occurrence_policies=[{"occurrenceId": r["occurrenceIds"][0], "action": r["action"]} for r in decisions])
    assert preview["spans"][0]["text"] == rendered["spans"][0]["text"].strip()


@pytest.mark.parametrize("verdict", ["PRESERVE", "UNCERTAIN", "invented"])
def test_narrative_numbered_labels_never_propagate_rejected_group(verdict, monkeypatch):
    calls = mocks(monkeypatch, verdict=verdict)
    extraction, dialogue = artifacts(label="Room")
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == []
    assert result["patternGroups"][0]["verdict"] in {"preserve", "uncertain", "invalid"}
    assert result["summary"]["patternPreservedWindows"] == 9
    assert len(calls["verification"]) == 1 and calls["repair"] == []


def test_context_veto_and_word_damage_are_not_group_omissions(monkeypatch):
    calls = mocks(monkeypatch, veto="青空文庫 9", damage="青空文庫 11")
    result = cleanup.run_cleanup_review(ROOT, *artifacts(), lambda *a: None)
    proposals = {row["source"]: row for row in result["occurrences"]}
    assert "青空文庫 9" not in proposals
    assert proposals["青空文庫 11"]["replacement"] is None
    assert "patternGroupId" not in proposals["青空文庫 11"]
    assert len(calls["verification"]) == len(calls["repair"]) == 1
    assert len(result["patternGroups"][0]["vetoes"]) == 2
    assert len([r for r in result["occurrences"] if r.get("patternVerification") == "verified"]) == 7


def test_dialogue_and_cross_spoken_boundary_candidates_do_not_join_families():
    extraction, dialogue = artifacts()
    dialogue["spans"][0]["renderRole"] = "dialogue"
    dialogue["spans"][1]["spokenEnd"] = dialogue["spans"][1]["source"].index("青空文庫")
    windows = cleanup.cleanup_windows(extraction, dialogue)
    assert not any(row.get("patternGroupId") for row in windows if row["blockId"] in {"1", "2"})
    assert len([row for row in windows if row.get("patternGroupId")]) == 7


def test_distinct_folio_offsets_and_labels_do_not_share_group_ids():
    first, _ = artifacts(3)
    later, _ = artifacts(3)
    for block in later["blocks"]:
        block.update(id="late" + block["id"], page=block["page"] + 10)
    rows = numbered_edge_candidates([*first["blocks"], *later["blocks"]])
    assert len({row["patternGroupId"] for row in rows}) == 2


@pytest.mark.parametrize("response", [None, {}, {"assessments": [], "reason": ""},
    {"assessments": [{"windowId": "1", "role": "FOOTER"}] * 3, "reason": ""},
    {"assessments": [{"windowId": "1", "role": "FOOTER"}], "reason": "partial"}])
def test_incomplete_verification_never_authorizes_group(response):
    assert pattern_verdict(response, [{"windowId": str(i)} for i in range(3)])[0] == "invalid"


def test_invalid_group_authority_cannot_be_attached_to_proposals(monkeypatch):
    mocks(monkeypatch)
    extraction, dialogue = artifacts()
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    result["occurrences"][0]["patternGroupId"] = "forged"
    with pytest.raises(ReviewContractError, match="Pattern"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_vetoed_anchor_cannot_borrow_a_neighbors_eligible_window_evidence(monkeypatch):
    mocks(monkeypatch, veto="青空文庫 9")
    extraction, dialogue = artifacts()
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    borrowed = dict(result["occurrences"][0])
    target = next(row for row in numbered_edge_candidates(extraction["blocks"]) if row["source"] == "青空文庫 9")
    borrowed.update({key: target[key] for key in ("blockId", "sourceStart", "sourceEnd", "source")})
    result["occurrences"] = [borrowed]
    with pytest.raises(ReviewContractError, match="Pattern"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


@pytest.mark.parametrize("field,value", [("patternGroupId", "other"), ("patternVerdict", "uncertain")])
def test_occurrence_evidence_must_agree_with_its_verified_group(monkeypatch, field, value):
    mocks(monkeypatch)
    extraction, dialogue = artifacts()
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    proposal = result["occurrences"][0]
    evidence = next(row for row in result["windows"] if row["windowId"] == proposal["windowId"])
    evidence[field] = value
    with pytest.raises(ReviewContractError, match="Pattern"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


@pytest.mark.parametrize("mutation", ["count", "members", "representatives", "verdict", "partial_verification", "duplicate_window"])
def test_group_evidence_counts_representatives_and_verdict_are_revalidated(monkeypatch, mutation):
    mocks(monkeypatch)
    extraction, dialogue = artifacts()
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    group = result["patternGroups"][0]
    if mutation == "count":
        group["eligibleCount"] += 1
    elif mutation == "members":
        group["eligibleWindowIds"] = group["eligibleWindowIds"][:-1]
    elif mutation == "representatives":
        group["representativeWindowIds"][1] = group["representativeWindowIds"][0]
    elif mutation == "verdict":
        group["verification"]["assessments"][0]["role"] = "PRESERVE"
    elif mutation == "partial_verification":
        group["verification"]["assessments"].pop()
    else:
        row = next(row for row in result["windows"] if row.get("patternGroupId"))
        result["windows"].append(deepcopy(row))
    with pytest.raises(ReviewContractError, match="Pattern"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_insufficient_contextual_support_preserves_family_without_luna_calls(monkeypatch):
    calls = mocks(monkeypatch, veto="青空文庫 9")
    extraction, dialogue = artifacts(3)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == [] and calls["verification"] == calls["repair"] == []
    assert result["patternGroups"][0]["verdict"] == "insufficient"
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    accepted = accept_review_revision(workspace, [], revision="preserved")
    assert accepted["cleanupPatternEvidence"]["groups"][0]["eligibleCount"] == 2
    assert apply_review_render_policies(dialogue, accepted)["spans"] == dialogue["spans"]


def test_group_verification_transport_failure_keeps_atomic_failure_behavior(monkeypatch):
    mocks(monkeypatch)
    extraction, dialogue = artifacts()
    original = deepcopy((extraction, dialogue))

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(cleanup, "remote_chat_completion", unavailable)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert (extraction, dialogue) == original
