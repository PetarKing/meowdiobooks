"""Source preservation, incomplete checks, and bounded cleanup transport contracts."""
import io
import json
import threading
import time
import urllib.error
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest

from meowdiobooks.backend import cleanup_remote as cleanup
from meowdiobooks.backend import remote_llm

ROOT = Path(__file__).resolve().parents[2]


def artifacts(text, *, spoken_start=0, spoken_end=None):
    return ({"blocks": [{"id": "b1", "text": text, "page": 2}]}, {"spans": [{
        "id": "s1", "blockId": "b1", "sourceStart": 0, "sourceEnd": len(text),
        "spokenStart": spoken_start, "spokenEnd": len(text) if spoken_end is None else spoken_end,
        "source": text,
    }]})


def answers(production="clean", word_damage="clean"):
    return {"answers": [{"name": name, "type": "choice", "choice": choice} for name, choice in (
        ("production", production), ("word_damage", word_damage),
    )]}


def proposal(before, after):
    return {"action": "repair", "edits": [{"before": before, "after": after}],
            "reason": "Mechanical extraction damage"}


def test_windows_preserve_source_and_stay_inside_spoken_ranges():
    text = 'Alice: “' + "A long paragraph. " * 200 + '\n\nAnother paragraph.”'
    extraction, dialogue = artifacts(text, spoken_start=8, spoken_end=len(text)-1)
    windows = cleanup.cleanup_windows(extraction, dialogue)
    assert len(windows) >= 4
    for window in windows:
        assert window["source"] == text[window["sourceStart"]:window["sourceEnd"]]
        assert 8 <= window["sourceStart"] < window["sourceEnd"] <= len(text)-1
        assert len(window["source"]) <= cleanup.MAX_WINDOW_CHARACTERS
        assert len(window["contextBefore"]) <= 180
    # Only paragraph separators can be omitted; no source words vanish at split points.
    assert "".join(row["source"] for row in windows).replace("\n", "") == text[8:-1].replace("\n", "")


@pytest.mark.parametrize("mutation", ["missing", "source", "overlap", "range"])
def test_windows_reject_broken_source_contract(mutation):
    extraction, dialogue = artifacts("Story text.")
    if mutation == "missing":
        dialogue["spans"] = []
    elif mutation == "source":
        dialogue["spans"][0]["source"] = "Changed text."
    elif mutation == "overlap":
        dialogue["spans"] *= 2
    else:
        dialogue["spans"][0]["spokenEnd"] = 999
    with pytest.raises(cleanup.CleanupReviewError):
        cleanup.cleanup_windows(extraction, dialogue)


@pytest.mark.parametrize("response", [
    {}, {"answers": []}, {"answers": [None, None]},
    {"answers": [{"name": "production", "type": "choice", "choice": "clean"}] * 2},
    answers(word_damage="probably"),
])
def test_missing_malformed_or_duplicate_answers_fail_candidate(monkeypatch, response):
    monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: response)
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: pytest.fail("No repair"))
    with pytest.raises(cleanup.CleanupReviewError):
        cleanup.run_cleanup_review(ROOT, *artifacts("Story text."), lambda *a: None)


@pytest.mark.parametrize("before,after", [
    ("un-\nderstand", "understand"), ("mergedwords", "merged words"),
    ("cafÃ©", "café"), ("word\x0cword", "word word"), ("Production credit", ""),
])
def test_provable_mechanical_edits_and_deletions_remain_reviewable(before, after):
    assert cleanup.validate_cleanup_edits("prefix " + before, proposal(before, after)) == [
        (7, 7+len(before), after),
    ]


@pytest.mark.parametrize("source,change", [
    ("aaa", proposal("aa", "a")),  # overlapping duplicate anchors
    ("word", proposal("missing", "")),
    ("word", proposal("word", "word")),
    ("A handsome hero", proposal("handsome", "cruel")),
    ("word", {"action": "keep", "edits": [{"before": "word", "after": ""}], "reason": "x"}),
    ("abc def", {"action": "repair", "edits": [
        {"before": "abc", "after": ""}, {"before": "bc def", "after": ""}], "reason": "x"}),
    ("x" * 401, proposal("x" * 401, "")),
    ("word", {"action": "repair", "edits": [], "reason": "x"}),
])
def test_unsafe_ambiguous_or_overlapping_proposals_rejected(source, change):
    with pytest.raises(cleanup.CleanupReviewError):
        cleanup.validate_cleanup_edits(source, change)


def test_full_check_routes_flagged_only_preserves_source_and_emits_exact_edits(monkeypatch):
    extraction, dialogue = artifacts("Un-\nbroken.\n\nClean prose.")
    before = deepcopy((extraction, dialogue))
    calls = []

    def decide(root, config, prompt, questions, **kwargs):
        assert config.model == "gpt-6-luna"
        target = json.loads(prompt)["TARGET"]
        return answers(word_damage="review" if "Un-" in target else "clean")

    def repair(root, config, system, prompt, **kwargs):
        calls.append(json.loads(prompt)["TARGET"])
        return {"text": json.dumps(proposal("Un-\nbroken", "Unbroken"))}

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", repair)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["summary"] == {
        "model": "gpt-6-luna", "policy": cleanup.POLICY_ID,
        "inputWindows": 2, "flaggedWindows": 1, "proposals": 1, "sourceReview": 0,
    }
    assert calls == ["Un-\nbroken."]
    assert result["occurrences"][0]["sourceStart"] == 0
    assert result["occurrences"][0]["sourceEnd"] == 10
    assert result["occurrences"][0]["replacement"] == "Unbroken"
    assert result["occurrences"][0]["proposalStatus"] == "proposed"
    assert (extraction, dialogue) == before
    assert len(result["windows"]) == 2


@pytest.mark.parametrize("change", [
    proposal("hero", "villain"),
    {"action": "source_review", "edits": [], "reason": "Missing source words"},
    {"action": "keep", "edits": [], "reason": "No clear safe edit"},
])
def test_flagged_but_unrepairable_windows_stay_visible(monkeypatch, change):
    monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: answers(word_damage="uncertain"))
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: {"text": json.dumps(change)})
    result = cleanup.run_cleanup_review(ROOT, *artifacts("The hero."), lambda *a: None)
    assert result["summary"]["sourceReview"] == 1
    assert result["occurrences"][0]["replacement"] is None


def test_unreadable_repair_fails_instead_of_disappearing(monkeypatch):
    monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: answers(word_damage="review"))
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: {"text": "not json"})
    with pytest.raises(cleanup.CleanupReviewError):
        cleanup.run_cleanup_review(ROOT, *artifacts("Broken word."), lambda *a: None)


def test_bounded_concurrency_processes_every_window(monkeypatch):
    lock, active, peak = threading.Lock(), 0, 0

    def decide(*args, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.005)
        with lock:
            active -= 1
        return answers()

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    result = cleanup.run_cleanup_review(ROOT, *artifacts("\n\n".join(f"Paragraph {i}" for i in range(20))), lambda *a: None)
    assert result["summary"]["inputWindows"] == 20
    assert len(result["windows"]) == 20
    assert 1 < peak <= 4


def test_config_strictly_requires_luna(monkeypatch):
    config = cleanup.cleanup_model_configs(ROOT)[1]

    class Registry:
        def remote_dialogue_model(self):
            return replace(config, model="other-model")

    monkeypatch.setattr(cleanup, "load_model_registry", lambda _: Registry())
    with pytest.raises(remote_llm.RemoteModelUnavailableError, match="gpt-6-luna"):
        cleanup.cleanup_model_configs(ROOT)


class Response:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode()


def test_decisions_transport_retries_admits_and_accounts_every_attempt(monkeypatch):
    config = cleanup.cleanup_model_configs(ROOT)[0]
    attempts, admissions, completions, observed = [], [], [], []
    monkeypatch.setattr(remote_llm, "configured_api_key", lambda *a: "test-key")
    monkeypatch.setattr(remote_llm.time, "sleep", lambda _: None)

    def open_response(request, timeout):
        assert request.full_url.endswith("/v1/decisions")
        assert timeout == 90
        payload = json.loads(request.data)
        assert payload["model"] == "gpt-6-luna"
        assert "service_tier" not in payload
        attempts.append(payload)
        if len(attempts) == 1:
            raise urllib.error.HTTPError(request.full_url, 429, "limited", {}, io.BytesIO(b"secret"))
        return Response({**answers(), "model": "gpt-6-luna", "usage": {"input_tokens": 100, "output_tokens": 0}})

    def admit(cfg, metadata):
        assert cfg.output_usd_per_million_tokens == 0
        admissions.append(metadata)
        return completions.append

    monkeypatch.setattr(remote_llm.urllib.request, "urlopen", open_response)
    result = remote_llm.remote_decisions_completion(
        ROOT, config, "text", cleanup._QUESTIONS,
        request_admission=admit, usage_observer=lambda cfg, event: observed.append(event),
    )
    assert len(result["answers"]) == 2
    assert [row["attempt"] for row in admissions] == [1, 2]
    assert all(row["maximumOutputTokens"] == 1 for row in admissions)
    assert [row["outcome"] for row in completions] == ["http-error", "response"]
    assert completions == observed
    assert remote_llm.remote_usage_cost(config, result["usage"]) == pytest.approx(0.00001)


def test_decisions_admission_denial_never_calls_network_or_retries(monkeypatch):
    monkeypatch.setattr(remote_llm, "configured_api_key", lambda *a: "test-key")
    monkeypatch.setattr(remote_llm.urllib.request, "urlopen", lambda *a, **k: pytest.fail("Denied request sent"))

    def deny(*args):
        raise RuntimeError("quota denied")

    with pytest.raises(RuntimeError, match="quota denied"):
        remote_llm.remote_decisions_completion(ROOT, cleanup.cleanup_model_configs(ROOT)[0], "text", [], request_admission=deny)


def test_outage_fails_candidate_and_cancellation_stops_before_network(monkeypatch):
    monkeypatch.setattr(remote_llm, "configured_api_key", lambda *a: "test-key")
    calls = []

    def offline(*args, **kwargs):
        calls.append(1)
        raise OSError("offline")

    monkeypatch.setattr(remote_llm.urllib.request, "urlopen", offline)
    monkeypatch.setattr(remote_llm.time, "sleep", lambda _: None)
    with pytest.raises(remote_llm.RemoteModelUnavailableError):
        cleanup.run_cleanup_review(ROOT, *artifacts("Story"), lambda *a: None)
    assert len(calls) == 4
    calls.clear()

    def cancelled(*args):
        raise RuntimeError("cancelled")

    with pytest.raises(RuntimeError, match="cancelled"):
        cleanup.run_cleanup_review(ROOT, *artifacts("Story"), cancelled)
    assert calls == []


def test_isolated_footer_receives_adjacent_block_context_without_edit_scope_expansion():
    extraction, dialogue = artifacts("Publisher 20")
    extraction["blocks"].insert(0, {"id": "previous", "page": 2, "text": "The story ends here."})
    extraction["blocks"].append({"id": "next", "page": 3, "text": "The next page begins."})
    window = cleanup.cleanup_windows(extraction, dialogue)[0]
    assert window["contextBefore"].endswith("The story ends here.\n")
    assert window["contextAfter"].startswith("\nThe next page begins.")
    assert window["source"] == "Publisher 20"
    assert (window["sourceStart"], window["sourceEnd"]) == (0, 12)


def test_explicit_registry_path_is_used_by_runner(monkeypatch, tmp_path):
    config = cleanup.cleanup_model_configs(ROOT)[1]
    recorded = []

    class Registry:
        def remote_dialogue_model(self):
            return config

    def load(root, *, models_path):
        recorded.append((root, models_path))
        return Registry()

    monkeypatch.setattr(cleanup, "load_model_registry", load)
    monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: answers())
    cleanup.run_cleanup_review(ROOT, *artifacts("Story."), lambda *a: None, models_path=tmp_path / "hosted.toml")
    assert recorded == [(ROOT, tmp_path / "hosted.toml")]
