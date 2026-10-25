"""Independent protections around potentially destructive script cue suggestions."""
import json
from copy import deepcopy
from pathlib import Path

import pytest

from meowdiobooks.backend import cleanup_remote, script_cues as cues
from meowdiobooks.backend.remote_llm import RemoteModelUnavailableError

ROOT = Path(__file__).resolve().parents[2]


def artifacts(text, *, role="dialogue"):
    start = text.find(":") + 1
    while start < len(text) and text[start].isspace():
        start += 1
    return ({"blocks": [{"id": "b1", "text": text, "page": 1}]}, {"spans": [{
        "id": "s1", "blockId": "b1", "sourceStart": 0, "sourceEnd": len(text),
        "spokenStart": start, "spokenEnd": len(text), "source": text,
        "renderRole": role, "origin": "regex:label-colon-line",
    }]})


def response(probability=.99):
    return {"answers": [{"name": "role", "type": "choice", "choice": "DELIVERY",
        "probabilities": [{"value": name, "probability": value} for name, value in
            (("DELIVERY", probability), ("STORY", 1-probability), ("WORDS", 0), ("UNSURE", 0))]}]}


def verified(classification="DELIVERY", status="completed"):
    return {"responseStatus": status, "text": json.dumps({"classification": classification, "reason": "Context checked"})}


@pytest.mark.parametrize("text,candidate", [
    ("MARA: (creepily) Welcome.", "(creepily)"),
    ("MARA: [said very loudly] Leave!", "[said very loudly]"),
    ("MARA: (whispers [very] softly) Stay.", "(whispers [very] softly)"),
    ("玛拉: [轻声地说] 请留下。", "[轻声地说]"),
])
def test_candidates_have_exact_immutable_anchors(text, candidate):
    extraction, dialogue = artifacts(text)
    before = deepcopy((extraction, dialogue))
    rows = cues.script_cue_candidates(extraction, dialogue)
    assert [row["source"] for row in rows] == [candidate]
    assert text[rows[0]["sourceStart"]:rows[0]["sourceEnd"]] == candidate
    assert (extraction, dialogue) == before


@pytest.mark.parametrize("text", [
    "MARA: [I will return.]", "MARA: [I will return.] [1]", "MARA: [softly] [1]",
    "MARA: (softly] Stay.", "MARA: [(softly] Stay.", "MARA: (softly Stay.",
    "MARA: Wait (until sunset).", "MARA: [softly]", "MARA: [softly] (whispering)",
    "MARA: [softly] " + "x" * 1200, "MARA: (" + "x" * 241 + ") Wait.",
])
def test_format_gate_preserves_non_candidates_even_with_maximum_confidence(text):
    assert cues.script_cue_candidates(*artifacts(text)) == []


def test_prose_and_source_mismatch_never_become_script_candidates():
    assert cues.script_cue_candidates(*artifacts("MARA: (softly) Stay.", role="narration")) == []
    extraction, dialogue = artifacts("MARA: (softly) Stay.")
    dialogue["spans"][0]["source"] = "changed"
    assert cues.script_cue_candidates(extraction, dialogue) == []


@pytest.mark.parametrize("bad", [None, {}, {"answers": []}, response(.89), response(float("nan")), response(True)])
def test_invalid_or_low_confidence_answer_preserves(bad):
    assert not cues.delivery_answer(bad)


def test_duplicate_categories_and_nonstring_values_preserve():
    for name in ("STORY", [], None):
        value = response()
        value["answers"][0]["probabilities"][0]["value"] = name
        assert not cues.delivery_answer(value)


@pytest.mark.parametrize("bad", [verified("STORY"), verified("WORDS"), verified("UNSURE"),
    verified(status="incomplete"), verified(status=None), {"text": "not json"},
    {"responseStatus": "completed", "text": json.dumps({"classification": "DELIVERY"})}])
def test_verifier_requires_complete_strict_pure_delivery(bad):
    assert not cues.verified_delivery(bad)


def test_two_checks_required_and_no_rewrite(monkeypatch):
    inputs = artifacts("MARA: (said angrily) Leave.")
    before = deepcopy(inputs)
    calls = []
    monkeypatch.setattr(cues, "remote_decisions_completion", lambda *a, **k: response())
    def verify(*args, **kwargs):
        calls.append(kwargs)
        return verified()
    monkeypatch.setattr(cues, "remote_chat_completion", verify)
    result = cues.review_script_directions(ROOT, *inputs, cleanup_remote.cleanup_model_configs(ROOT), lambda *a: None)
    assert len(result["occurrences"]) == 1
    assert result["occurrences"][0]["source"] == "(said angrily)"
    assert result["occurrences"][0]["recommendedAction"] == "exclude"
    assert "replacement" not in result["occurrences"][0]
    assert calls[0]["max_completion_tokens"] == 700
    assert calls[0]["response_schema"] == cues.VERIFY_SCHEMA
    assert inputs == before


def test_disagreement_kept_and_transport_failure_remains_explicit(monkeypatch):
    inputs = artifacts("ALICE: [whispering] is the password.")
    configs = cleanup_remote.cleanup_model_configs(ROOT)
    monkeypatch.setattr(cues, "remote_decisions_completion", lambda *a, **k: response())
    monkeypatch.setattr(cues, "remote_chat_completion", lambda *a, **k: verified("WORDS"))
    result = cues.review_script_directions(ROOT, *inputs, configs, lambda *a: None)
    assert result == {"occurrences": [], "summary": {"candidates": 1, "proposals": 0, "kept": 1}}
    def fail(*args, **kwargs):
        raise RemoteModelUnavailableError("interrupted")
    monkeypatch.setattr(cues, "remote_chat_completion", fail)
    with pytest.raises(RemoteModelUnavailableError):
        cues.review_script_directions(ROOT, *inputs, configs, lambda *a: None)


def test_general_cleanup_cannot_bypass_script_preservation(monkeypatch):
    inputs = artifacts("ALICE: [whispering] is the password.")
    monkeypatch.setattr(cleanup_remote, "remote_decisions_completion", lambda *a, **k: {
        "answers": [{"name": name, "type": "choice", "choice": "review"}
                    for name in ("production", "word_damage")]})
    monkeypatch.setattr(cleanup_remote, "remote_chat_completion", lambda *a, **k: {"text": json.dumps({
        "action": "repair", "edits": [{"before": "[whispering]", "after": ""}], "reason": "bad deletion"})})
    monkeypatch.setattr(cues, "remote_decisions_completion", lambda *a, **k: response(.1))
    monkeypatch.setattr(cues, "remote_chat_completion", lambda *a, **k: pytest.fail("Must preserve"))
    result = cleanup_remote.run_cleanup_review(ROOT, *inputs, lambda *a: None)
    assert result["occurrences"] == []
    assert result["scriptDirections"]["occurrences"] == []


@pytest.mark.parametrize("proposal", [
    {"action": "keep", "edits": [], "reason": "This is authored text."},
    {"action": "source_review", "edits": [], "reason": "The wording is ambiguous."},
    {"action": "repair", "edits": [{"before": "missing anchor", "after": ""}],
     "reason": "The anchor cannot be verified."},
])
def test_protected_fallbacks_preserve_text_without_rejecting_review(monkeypatch, proposal):
    from meowdiobooks.backend.review import add_cleanup_proposals, build_review_workspace

    extraction, dialogue = artifacts("ALICE: (softly) Stay close.")
    extraction["revision"] = "e1"
    dialogue.update(revision="d1", extractionRevision="e1")
    monkeypatch.setattr(cleanup_remote, "remote_decisions_completion", lambda *a, **k: {
        "answers": [{"name": name, "type": "choice", "choice": "uncertain"}
                    for name in ("production", "word_damage")]})
    monkeypatch.setattr(cleanup_remote, "remote_chat_completion",
                        lambda *a, **k: {"text": json.dumps(proposal)})
    monkeypatch.setattr(cues, "remote_decisions_completion", lambda *a, **k: response(.1))
    result = cleanup_remote.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == []
    assert result["scriptDirections"]["summary"] == {
        "candidates": 1, "proposals": 0, "kept": 1,
    }
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue),
                                      extraction, dialogue, result)
    assert not any(group["kind"] in {"ai-cleanup", "stage-direction"}
                   for group in workspace["warnings"])
    assert extraction["blocks"][0]["text"] == "ALICE: (softly) Stay close."
