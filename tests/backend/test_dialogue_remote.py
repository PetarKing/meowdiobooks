import json
import re
import io
import threading
import urllib.error
from pathlib import Path

import pytest

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend import dialogue_remote


REPO_ROOT = Path(__file__).resolve().parents[2]


def _target_ids(payload):
    prompt = next(
        str(item["content"])
        for item in payload["input"]
        if item.get("role") == "user" and "REQUESTED TARGET IDS:" in str(item.get("content"))
    )
    section = prompt.split("REQUESTED TARGET IDS:\n", 1)[1].split("\n\nORDERED LOCAL SCENE:", 1)[0]
    return [line[2:] for line in section.splitlines() if line.startswith("- ")]


def _decision(target_id, speaker="?", *, classification="D"):
    return {
        "targetId": target_id,
        "classification": classification,
        "speaker": "" if classification == "N" else speaker,
        "confidence": "high",
        "basis": "explicit-local" if classification == "D" else "not-dialogue",
        "evidencePages": [1],
        "evidenceQuote": "source evidence",
        "attributionReason": "The local speech tag identifies the speaker.",
        "outsideEvidenceUsed": False,
        "unresolvedReason": "",
    }


def _response(target_ids, speaker="?", *, classification="D", usage=True):
    text = json.dumps(
        {
            "decisions": [
                _decision(target_id, speaker, classification=classification)
                for target_id in target_ids
            ]
        }
    )
    return {
        "id": "response-1",
        "model": "test-luna",
        "usage": {"input_tokens": 100, "output_tokens": 10} if usage else {},
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def _install_speakers(monkeypatch, speakers):
    calls = []

    def factory(_config, effort, _observer, *, request_admission=None, check_cancelled=None):
        def call(payload):
            calls.append((effort, payload))
            return _response(_target_ids(payload), speakers[effort])

        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    return calls


def _single_dialogue(result):
    return next(span for span in result["partition"] if span.get("renderRole") == "dialogue")


def test_dual_pass_windows_use_eight_page_scenes_and_configured_batch_size():
    spans = [
        {"id": f"span-{index}", "page": 1 if index < 9 else 9}
        for index in range(13)
    ]
    target_ids = [str(span["id"]) for span in spans]

    windows = dialogue_remote._dialogue_windows(
        spans,
        target_ids,
        window_pages=8,
        max_targets=8,
    )

    assert [window["ownerIds"] for window in windows] == [
        target_ids[:8],
        target_ids[8:9],
        target_ids[9:],
    ]
    assert [window["contextPages"] for window in windows] == [[1], [1], [9]]


def test_dual_pass_accepts_independent_agreement_and_preserves_shared_contract(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice leaned closer. “Come with me,” she said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Alice"
    assert attributed["speakerStatus"] == "ai"
    assert attributed["origin"] == "remote:dual-pass-with-tools-v1"
    assert [effort for effort, _payload in calls] == ["low", "medium"]
    assert result["attributionRoute"] == "remote"
    assert result["resultSummary"]["aiConsensusAccepted"] == 1
    assert result["remoteUsage"] == {
        "inputTokens": 200,
        "cachedInputTokens": 0,
        "cacheWriteInputTokens": 0,
        "outputTokens": 20,
        "estimatedCostUsd": 0.0001,
        "modelProfile": "luna-dialogue",
        "modelDisplayName": "Luna",
        "providerModels": ["test-luna"],
        "policy": "dual-pass-with-tools-v1",
        "physicalRequests": 2,
        "toolCalls": 0,
        "adjudicatedTargets": 0,
    }


def test_meaningful_disagreement_is_adjudicated_instead_of_blanket_withheld(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Bob", "high": "Carol"},
    )
    scan = scan_dialogue(
        [
            {
                "page": 1,
                "text": "Alice, Bob, and Carol waited. “Come with me,” someone said.",
            }
        ]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Carol"
    assert [effort for effort, _payload in calls] == ["low", "medium", "high"]
    assert result["remoteUsage"]["adjudicatedTargets"] == 1
    assert result["remoteUsage"]["physicalRequests"] == 3
    assert result["attributionChecks"][0]["resolution"] == "adjudicated"


def test_surface_compatible_names_choose_stronger_pass_without_alias_prompt(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice Smith", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice Smith waited. “Come with me,” Alice said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice Smith"
    assert [effort for effort, _payload in calls] == ["low", "medium"]
    assert all("alias" not in json.dumps(payload).casefold() for _effort, payload in calls)


def test_stronger_pass_can_read_beyond_scene_with_model_shaped_output(monkeypatch):
    calls = []
    medium_requests = 0

    def factory(_config, effort, _observer, *, request_admission=None, check_cancelled=None):
        def call(payload):
            nonlocal medium_requests
            calls.append((effort, payload))
            target_ids = _target_ids(payload)
            if effort == "medium" and medium_requests == 0:
                medium_requests += 1
                return {
                    "id": "tool-response",
                    "model": "test-luna",
                    "usage": {"input_tokens": 50, "output_tokens": 5},
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "tool-1",
                            "name": "read_beyond_scene",
                            "arguments": json.dumps(
                                {"direction": "after", "page_count": 1}
                            ),
                        }
                    ],
                }
            return _response(target_ids, "Alice")

        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue(
        [
            {"page": 8, "text": "Alice waited. “Who is there?”"},
            {"page": 9, "text": "Alice lowered her hand after asking the question."},
        ]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    medium_second_payload = [payload for effort, payload in calls if effort == "medium"][-1]
    tool_output = next(
        item["output"]
        for item in medium_second_payload["input"]
        if item.get("type") == "function_call_output"
    )
    assert "OUTSIDE-SCENE CONTINUATION — AFTER" in tool_output
    assert "Alice lowered her hand" in tool_output
    assert result["remoteUsage"]["toolCalls"] == 1
    assert result["remoteUsage"]["physicalRequests"] == 3


def test_generic_roles_are_guarded_to_question_mark_and_not_suggested(monkeypatch):
    _install_speakers(
        monkeypatch,
        {"low": "Guard", "medium": "Guard", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "The guard raised a hand. “Stop there,” he said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["speakerStatus"] == "unresolved"
    assert result["attributionChecks"][0]["suggestedSpeakers"] == []


def test_attribution_does_not_add_a_step_specific_punctuation_filter(monkeypatch):
    _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice watched the signal. “----”"}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Alice"
    assert attributed["speakerStatus"] == "ai"


def test_every_payload_disables_provider_storage_and_uses_strict_schema(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice waited. “Ready?” she asked."}]
    )

    dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    assert all(payload["store"] is False for _effort, payload in calls)
    assert all(payload["text"]["format"]["strict"] is True for _effort, payload in calls)
    assert all(
        payload["text"]["format"]["schema"]["additionalProperties"] is False
        for _effort, payload in calls
    )
    assert all(not re.search(r"\balias(?:es)?\b", json.dumps(payload), re.I) for _, payload in calls)


def test_dialogue_cost_prices_each_physical_request_before_aggregating(monkeypatch):
    def factory(_config, effort, _observer, *, request_admission=None, check_cancelled=None):
        def call(payload):
            response = _response(_target_ids(payload), "Alice")
            response["usage"] = {"input_tokens": 200_000, "output_tokens": 10}
            response["service_tier"] = "fast" if effort == "low" else "default"
            return response
        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{'page': 1, 'text': '“Hello,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert result["remoteUsage"]["inputTokens"] == 400_000
    # Neither 200K request incurs long-context pricing; the second is billed at default tier.
    assert result["remoteUsage"]["estimatedCostUsd"] == 0.06


def test_unknown_provider_tier_preserves_attribution_without_fabricated_cost(monkeypatch):
    def factory(_config, _effort, _observer, *, request_admission=None, check_cancelled=None):
        def call(payload):
            response = _response(_target_ids(payload), "Alice")
            response["service_tier"] = "future-tier"
            return response
        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{'page': 1, 'text': '“Hello,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert "estimatedCostUsd" not in result["remoteUsage"]
    assert result["remoteUsage"]["physicalRequests"] == 2
    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice"


def test_explicit_legacy_luna_profile_remains_supported(monkeypatch):
    from dataclasses import replace
    from meowdiobooks.backend.model_config import load_model_registry

    registry = load_model_registry(REPO_ROOT)
    config = registry.remote_dialogue_model()
    legacy = replace(config, model="gpt-5.6-luna", service_tier=None,
                     output_usd_per_million_tokens=1.2)
    registry = replace(registry, remote_text_models={**registry.remote_text_models, config.id: legacy})
    monkeypatch.setattr(dialogue_remote, "load_model_registry", lambda _root: registry)
    calls = _install_speakers(monkeypatch, {"low": "Alice", "medium": "Alice", "high": "unused"})
    scan = scan_dialogue([{'page': 1, 'text': '“Hello,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice"
    assert [effort for effort, _payload in calls] == ["low", "medium"]


def test_failed_batch_stops_queued_work_and_paid_followups():
    stopped = threading.Event()
    all_started = threading.Barrier(4)
    started = []
    reports = []

    def run(index):
        started.append(index)
        all_started.wait(timeout=2)
        if index == 0:
            raise ValueError("malformed provider JSON")
        assert stopped.wait(timeout=2)
        return index

    with pytest.raises(ValueError, match="malformed provider JSON"):
        list(dialogue_remote._bounded_batches(
            list(range(100)), run, 4, stopped,
            lambda _progress, message: reports.append(message),
        ))

    assert sorted(started) == [0, 1, 2, 3]
    assert reports == ["Stopping remaining speaker checks after an error or cancellation"]


def test_batch_progress_cancellation_does_not_admit_remaining_work():
    stopped = threading.Event()
    started = []

    def run(index):
        started.append(index)
        return index

    with pytest.raises(RuntimeError, match="cancel requested"):
        for _job, _result in dialogue_remote._bounded_batches(
            list(range(100)), run, 1, stopped, lambda *_: None,
        ):
            raise RuntimeError("cancel requested")
    assert started == [0]
    assert stopped.is_set()


def test_sixteen_workers_bound_independent_batches_without_losing_outputs():
    stopped = threading.Event()
    all_started = threading.Barrier(16)
    lock = threading.Lock()
    active = peak = 0

    def run(index):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        all_started.wait(timeout=2)
        with lock:
            active -= 1
        return index * 2

    results = list(dialogue_remote._bounded_batches(
        list(range(64)), run, 16, stopped, lambda *_: None,
    ))
    assert peak == 16
    assert sorted(results) == [(index, index * 2) for index in range(64)]


def test_rate_limit_retry_respects_server_delay_and_records_both_attempts(monkeypatch):
    from meowdiobooks.backend.model_config import load_model_registry

    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "synthetic-key")
    clock = [0.0]
    attempted = []
    observed = []
    monkeypatch.setattr(dialogue_remote.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(dialogue_remote.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    monkeypatch.setattr(dialogue_remote.random, "uniform", lambda *_: 0)

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps(_response([])).encode()

    def urlopen(*_args, **_kwargs):
        attempted.append(clock[0])
        if len(attempted) == 1:
            raise urllib.error.HTTPError(
                "https://synthetic.invalid", 429, "slow down", {"Retry-After": "7"}, io.BytesIO(b""),
            )
        return Response()

    monkeypatch.setattr(dialogue_remote.urllib.request, "urlopen", urlopen)
    call = dialogue_remote._responses_api_call(config, "low", lambda _config, event: observed.append(event))
    call({"max_output_tokens": 100})
    assert len(attempted) == 2
    assert attempted[1] >= 7
    assert [event["outcome"] for event in observed] == ["http-error", "response"]


def test_excessive_server_delay_defers_without_replaying_request(monkeypatch):
    from meowdiobooks.backend.model_config import load_model_registry

    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "synthetic-key")
    attempts = []

    def urlopen(*_args, **_kwargs):
        attempts.append(1)
        raise urllib.error.HTTPError(
            "https://synthetic.invalid", 429, "slow down", {"Retry-After": "120"}, io.BytesIO(b""),
        )

    monkeypatch.setattr(dialogue_remote.urllib.request, "urlopen", urlopen)
    call = dialogue_remote._responses_api_call(config, "low", None)
    with pytest.raises(dialogue_remote.DialogueContractError, match="HTTP 429"):
        call({"max_output_tokens": 100})
    assert attempts == [1]


def test_cancellation_before_retry_keeps_completed_call_receipt(monkeypatch):
    from meowdiobooks.backend.model_config import load_model_registry

    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "synthetic-key")
    observed = []

    def urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://synthetic.invalid", 429, "slow down", {}, io.BytesIO(b""),
        )

    def check_cancelled():
        if observed:
            raise RuntimeError("cancel requested")

    monkeypatch.setattr(dialogue_remote.urllib.request, "urlopen", urlopen)
    call = dialogue_remote._responses_api_call(
        config, "low", lambda _config, event: observed.append(event),
        check_cancelled=check_cancelled,
    )
    with pytest.raises(RuntimeError, match="cancel requested"):
        call({"max_output_tokens": 100})
    assert len(observed) == 1


def test_retry_after_accepts_http_dates_and_ignores_invalid_values():
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime

    date = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=30))
    assert 28 < dialogue_remote._retry_after_seconds({"Retry-After": date}) <= 30
    for value in ("bad", "nan", "inf", "-1"):
        assert dialogue_remote._retry_after_seconds({"Retry-After": value}) == 0


def test_malformed_decisions_retry_only_the_affected_batch_and_preserve_usage(monkeypatch):
    calls = []

    def factory(_config, effort, _observer, **_kwargs):
        def call(payload):
            calls.append(effort)
            response = _response(_target_ids(payload), "Alice")
            if calls.count(effort) == 1:
                response["output"][0]["content"][0]["text"] = '{"decisions": ["unfinished'
            return response
        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{"page": 1, "text": '“Come with me,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice"
    assert result["remoteUsage"]["physicalRequests"] == 4
    assert sorted(calls) == ["low", "low", "medium", "medium"]


def test_persistently_invalid_multi_target_batch_splits_without_dropping_targets():
    attempts = []

    def run(window):
        owners = window["ownerIds"]
        attempts.append(list(owners))
        if len(owners) > 1:
            raise dialogue_remote._InvalidDecisions("truncated", [{"usage": {}}])
        return {"decisions": [{"targetId": owners[0]}], "requests": [{"usage": {}}],
                "toolTrace": [], "toolCalls": 0}

    result = dialogue_remote._recover_batch({"ownerIds": ["one", "two"]}, run)
    assert result["decisions"] == [{"targetId": "one"}, {"targetId": "two"}]
    assert attempts == [["one", "two"], ["one", "two"], ["one"], ["two"]]
    assert len(result["requests"]) == 4


@pytest.mark.parametrize("invalid", ["[]", "null", "", "missing-output"])
def test_invalid_decision_shapes_recover_in_the_same_batch(monkeypatch, invalid):
    calls = []

    def factory(_config, effort, _observer, **_kwargs):
        def call(payload):
            calls.append(effort)
            response = _response(_target_ids(payload), "Alice")
            if calls.count(effort) == 1:
                if invalid == "missing-output":
                    response.pop("output")
                else:
                    response["output"][0]["content"][0]["text"] = invalid
            return response
        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{"page": 1, "text": '“Come with me,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice"
    assert result["remoteUsage"]["physicalRequests"] == 4


def test_persistent_malformed_output_remains_explicitly_unresolved_without_blocking(monkeypatch):
    def factory(_config, _effort, _observer, **_kwargs):
        def call(payload):
            response = _response(_target_ids(payload), "Alice")
            response["output"][0]["content"][0]["text"] = '{"unfinished'
            return response
        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{"page": 1, "text": '“Come with me,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert result['attributionChecks'][0]['final'] == '?'
    assert result['attributionChecks'][0]['resolution'] == 'provider-output-unavailable'
    assert result['remoteUsage']['unavailableTargetCount'] == 1
    assert result['remoteUsage']['physicalRequests'] == 8
    assert ''.join(row['source'] for row in result['partition']) == ''.join(row['source'] for row in scan['partition'])


@pytest.mark.parametrize("corrupt", ["{}", "[]", '{"result": [], "sha256": "bad"}'])
def test_exact_input_checkpoints_reuse_valid_batches_and_regenerate_corruption(monkeypatch, tmp_path, corrupt):
    calls = _install_speakers(monkeypatch, {"low": "Alice", "medium": "Alice", "high": "unused"})
    scan = scan_dialogue([{"page": 1, "text": '“Come with me,” Alice said.'}])
    first = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps", checkpoint_dir=tmp_path)
    assert len(calls) == 2
    restored = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps", checkpoint_dir=tmp_path)
    assert restored == first
    assert len(calls) == 2
    next(tmp_path.glob('*/*.json')).write_text(corrupt)
    repaired = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps", checkpoint_dir=tmp_path)
    assert repaired == first
    assert len(calls) == 3
    changed = scan_dialogue([{"page": 1, "text": 'Alice waited. “Come with me,” Alice said.'}])
    dialogue_remote.run_dialogue_remote(REPO_ROOT, changed, "fill-gaps", checkpoint_dir=tmp_path)
    assert len(calls) == 5


def test_invalid_speaker_answer_recovers_before_final_source_resolution(monkeypatch):
    calls = []
    long_answer = 'Alice, the Caterpillar, the White Rabbit, the Queen, and the King'

    def factory(_config, effort, _observer, **_kwargs):
        def call(payload):
            calls.append(effort)
            return _response(_target_ids(payload), long_answer if calls.count(effort) == 1 else 'Alice')
        return call

    monkeypatch.setattr(dialogue_remote, '_responses_api_call', factory)
    scan = scan_dialogue([{'page': 1, 'text': '“Come with me,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, 'fill-gaps')
    assert result['attributionChecks'][0]['final'] == 'Alice'
    assert result['remoteUsage']['physicalRequests'] == 4


def test_cancellation_while_waiting_for_admission_never_dispatches(monkeypatch):
    from meowdiobooks.backend.model_config import load_model_registry
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "synthetic-key")
    cancelled = threading.Event()
    receipts = []
    def admit(_config, _metadata):
        cancelled.set()
        return receipts.append
    def check():
        if cancelled.is_set():
            raise RuntimeError("sibling failed")
    monkeypatch.setattr(dialogue_remote.urllib.request, "urlopen",
                        lambda *_a, **_kw: pytest.fail("must not dispatch after cancellation"))
    call = dialogue_remote._responses_api_call(config, "low", None,
                                              request_admission=admit, check_cancelled=check)
    with pytest.raises(RuntimeError, match="sibling failed"):
        call({"max_output_tokens": 100})
    assert len(receipts) == 1
    assert receipts[0]["outcome"] == "cancelled-before-send"
    assert receipts[0]["ambiguousBillable"] is False


def test_incomplete_response_retries_fresh_even_if_partial_text_is_valid_json(monkeypatch):
    calls = []
    def factory(_config, effort, _observer, **_kwargs):
        def call(payload):
            calls.append((effort, payload))
            response = _response(_target_ids(payload), "Alice")
            if sum(e == effort for e, _ in calls) == 1:
                response.update(status="incomplete", incomplete_details={"reason": "max_output_tokens"})
            return response
        return call
    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue([{"page": 1, "text": '“Come with me,” Alice said.'}])
    result = dialogue_remote.run_dialogue_remote(REPO_ROOT, scan, "fill-gaps")
    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice"
    assert result["remoteUsage"]["physicalRequests"] == 4
    assert all(len(payload["input"]) == 1 for _, payload in calls)
