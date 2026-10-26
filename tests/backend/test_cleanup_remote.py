"""Source preservation, incomplete checks, and bounded cleanup transport contracts."""
import io
import json
import threading
import urllib.error
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest

from meowdiobooks.backend import cleanup_remote as cleanup
from meowdiobooks.backend import cleanup_concurrency
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
        "patternGroups": 0, "patternVerifiedGroups": 0, "patternPreservedWindows": 0,
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
    {"action": "keep", "edits": [{"before": "hero", "after": ""}], "reason": "Contradictory"},
    {"action": "keep", "edits": [], "reason": 123},
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
    enough_started = threading.Event()

    def decide(*args, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active > 4:
                enough_started.set()
        assert enough_started.wait(5), "Screening still stops at four concurrent requests"
        with lock:
            active -= 1
        return answers()

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    result = cleanup.run_cleanup_review(ROOT, *artifacts("\n\n".join(f"Paragraph {i}" for i in range(20))), lambda *a: None)
    assert result["summary"]["inputWindows"] == 20
    assert len(result["windows"]) == 20
    assert 4 < peak <= cleanup.MAX_WORKERS


@pytest.mark.parametrize("kind,limit", [("decisions", 40), ("repair", 4)])
def test_provider_limits_are_shared_by_concurrent_book_jobs(monkeypatch, kind, limit):
    """Two jobs can fill one provider limit, but cannot each get their own allowance."""
    lock = threading.Lock()
    release, full, all_waiting = threading.Event(), threading.Event(), threading.Event()
    active = peak = completed = 0
    waiting_threads = set()
    actual_gate = threading.BoundedSemaphore(limit)

    class ObservedGate:
        def acquire(self, *, timeout):
            with lock:
                waiting_threads.add(threading.get_ident())
                if len(waiting_threads) == limit * 2:
                    all_waiting.set()
            return actual_gate.acquire(timeout=timeout)

        def release(self):
            actual_gate.release()

    monkeypatch.setitem(cleanup_concurrency._SLOTS, kind, ObservedGate())

    def provider_call():
        nonlocal active, peak, completed
        with lock:
            active += 1
            peak = max(active, peak)
            if active == limit:
                full.set()
        assert release.wait(5), "Test did not release the provider calls"
        with lock:
            active -= 1
            completed += 1

    def decide(*args, **kwargs):
        if kind == "decisions":
            provider_call()
        return answers(word_damage="review" if kind == "repair" else "clean")

    def repair(*args, **kwargs):
        provider_call()
        return {"text": json.dumps({"action": "source_review", "edits": [], "reason": "Inspect source"})}

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", repair)
    inputs = artifacts("\n\n".join(f"Paragraph {index}" for index in range(limit)))
    with ThreadPoolExecutor(max_workers=2) as jobs:
        futures = [jobs.submit(cleanup.run_cleanup_review, ROOT, *inputs, lambda *a: None) for _ in range(2)]
        try:
            assert full.wait(5)
            assert all_waiting.wait(5), "Both books must reach the shared gate"
            assert peak == limit
        finally:
            release.set()
        results = [future.result(timeout=5) for future in futures]
    assert completed == limit * 2
    assert peak == limit
    expected_ids = [window["windowId"] for window in cleanup.cleanup_windows(*inputs)]
    assert all([row["windowId"] for row in result["windows"]] == expected_ids for result in results)
    assert results[0] == results[1]


@pytest.mark.parametrize("kind", ["decisions", "repair"])
def test_cancellation_waiting_for_provider_slot_does_not_admit_or_call(monkeypatch, kind):
    """A waiting request notices cancellation without waiting for a busy provider to finish."""
    waiting = threading.Event()

    class ObservedGate(threading.BoundedSemaphore):
        def acquire(self, *args, **kwargs):
            if kwargs.get("timeout") is not None:
                waiting.set()
            return super().acquire(*args, **kwargs)

    gate = ObservedGate(1)
    gate.acquire()
    monkeypatch.setitem(cleanup_concurrency._SLOTS, kind, gate)
    cancel = threading.Event()
    admissions = []

    def report(*args):
        if cancel.is_set():
            raise RuntimeError("cancelled while queued")

    def decide(*args, **kwargs):
        assert kind == "repair", "Cancelled Decisions request reached provider"
        return answers(word_damage="review")

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: pytest.fail("Cancelled repair reached provider"))
    with ThreadPoolExecutor(max_workers=1) as job:
        future = job.submit(cleanup.run_cleanup_review, ROOT, *artifacts("A passage."), report,
                            request_admission=lambda *a: admissions.append(a))
        try:
            assert waiting.wait(5), "Cancellation must happen while waiting for the provider slot"
            cancel.set()
            with pytest.raises(RuntimeError, match="cancelled while queued"):
                future.result(timeout=2)
            assert admissions == []
        finally:
            gate.release()


def test_provider_slot_is_released_on_failure_without_extra_progress_writes(monkeypatch):
    gate = threading.BoundedSemaphore(1)
    monkeypatch.setitem(cleanup_concurrency._SLOTS, "decisions", gate)
    with pytest.raises(RuntimeError):
        with cleanup_concurrency.request_slot("decisions", lambda: pytest.fail("No wait needs no progress write")):
            raise RuntimeError("provider failed")
    assert gate.acquire(blocking=False)
    gate.release()


def test_waiting_threads_share_progress_checks_but_not_stop_detection(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(cleanup_concurrency, "monotonic", lambda: clock[0])
    stopped = threading.Event()
    cancelled = threading.Event()
    reports = []

    def check_stopped():
        if stopped.is_set():
            raise RuntimeError("job stopped")

    def check_cancelled():
        reports.append(clock[0])
        if cancelled.is_set():
            raise RuntimeError("job cancelled")

    poll = cleanup_concurrency.cancellation_poll(check_stopped, check_cancelled)
    with ThreadPoolExecutor(max_workers=40) as waiters:
        list(waiters.map(lambda _: poll(), range(80)))
    assert reports == [100.0]
    clock[0] = 100.05
    stopped.set()
    with pytest.raises(RuntimeError, match="job stopped"):
        poll()  # A stopped job is noticed even inside the coalescing interval.
    assert reports == [100.0]
    stopped.clear()
    cancelled.set()
    clock[0] = 100.2
    with pytest.raises(RuntimeError, match="job cancelled"):
        poll()
    assert reports == [100.0, 100.2]


@pytest.mark.parametrize("kind", ["decisions", "repair"])
def test_admission_cancels_after_acquiring_slot_before_network_and_releases_it(monkeypatch, kind):
    acquired = threading.Event()

    class ObservedGate(threading.BoundedSemaphore):
        def acquire(self, *args, **kwargs):
            success = super().acquire(*args, **kwargs)
            if success:
                acquired.set()
            return success

    gate = ObservedGate(1)
    monkeypatch.setitem(cleanup_concurrency._SLOTS, kind, gate)
    monkeypatch.setattr(remote_llm, "configured_api_key", lambda *a: "test-key")
    monkeypatch.setattr(remote_llm.urllib.request, "urlopen", lambda *a, **k: pytest.fail("Cancelled request reached network"))
    if kind == "repair":
        monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: answers(word_damage="review"))

    def report(*args):
        if acquired.is_set():
            raise RuntimeError("cancelled before admission")

    with pytest.raises(RuntimeError, match="cancelled before admission"):
        cleanup.run_cleanup_review(ROOT, *artifacts("A passage."), report,
                                   request_admission=lambda *a: pytest.fail("Cancelled request reserved quota"))
    assert gate.acquire(blocking=False)
    gate.release()


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


@pytest.mark.parametrize("initial", ["review", "uncertain"])
def test_valid_second_pass_keep_clears_flag_without_changing_source(monkeypatch, initial):
    extraction, dialogue = artifacts("The contents were shared with her.")
    before = deepcopy((extraction, dialogue))
    monkeypatch.setattr(cleanup, "remote_decisions_completion", lambda *a, **k: answers(production=initial))
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: {"text": json.dumps(
        {"action": "keep", "edits": [], "reason": "This is ordinary narrative prose."})})
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == []
    assert result["summary"]["sourceReview"] == result["summary"]["flaggedWindows"] == 0
    assert result["windows"][0]["answers"]["production"] == initial
    assert (extraction, dialogue) == before


def _numbered_pages(label="Room"):
    blocks = [{"id": str(i), "page": i, "text": f"They explored the building.\n{label} {i}"}
              for i in range(1, 4)]
    return ({"revision": "e1", "blocks": blocks}, {"revision": "d1", "spans": [
        {"id": b["id"], "blockId": b["id"], "sourceStart": 0, "sourceEnd": len(b["text"]),
         "source": b["text"], "renderRole": "narration"} for b in blocks]})


def test_repeated_numbered_story_is_only_model_evidence_and_keep_retains_it(monkeypatch):
    from meowdiobooks.backend.review import build_review_workspace
    extraction, dialogue = _numbered_pages()
    assert build_review_workspace(extraction, dialogue)["warnings"] == []
    seen = []

    def decide(_root, _config, prompt, *_args, **_kwargs):
        payload = json.loads(prompt)
        if "structural_evidence" not in payload:
            return answers()
        evidence = payload["structural_evidence"][0]
        assert payload["TARGET"][evidence["targetStart"]:evidence["targetEnd"]].startswith("Room ")
        assert evidence["distinctPageCount"] == 3
        assert evidence["folioOffset"] == 0
        assert evidence["firstPage"] == 1 and evidence["lastPage"] == 3
        seen.append(payload)
        return answers(production="review")

    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    monkeypatch.setattr(cleanup, "remote_chat_completion", lambda *a, **k: {"text": json.dumps(
        {"action": "keep", "edits": [], "reason": "Narrative room labels; retain them."})})
    before = deepcopy((extraction, dialogue))
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == [] and len(seen) == 3
    assert (extraction, dialogue) == before


def test_pattern_context_does_not_add_other_page_text_or_cross_spoken_boundaries():
    extraction, dialogue = _numbered_pages("青空文庫")
    windows = cleanup.cleanup_windows(extraction, dialogue)
    for window in windows:
        if "structuralEvidence" not in window:
            continue
        evidence = window["structuralEvidence"][0]
        assert all(isinstance(v, int) for k, v in evidence.items() if k != "kind")
        assert len(window["source"][evidence["targetStart"]:evidence["targetEnd"]]) > 0
    for span in dialogue["spans"]:
        span["spokenEnd"] = span["source"].index("\n")
    limited = cleanup.cleanup_windows(extraction, dialogue)
    assert all("structuralEvidence" not in window for window in limited)
