"""A completion belongs to one physical request, including transport retries."""

import io
import http.client
import json
import urllib.error
from pathlib import Path

import pytest

from meowdiobooks.backend.dialogue_remote import _responses_api_call
from meowdiobooks.backend.model_config import load_model_registry
from meowdiobooks.backend.remote_llm import remote_chat_completion

ROOT = Path(__file__).resolve().parents[2]


class Response:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def success():
    return json.dumps({"model": "gpt-6-luna", "usage": {
        "input_tokens": 100, "output_tokens": 10,
    }, "output": [{"type": "message", "content": [
        {"type": "output_text", "text": "valid"},
    ]}]}).encode()


@pytest.mark.parametrize("kind", ["dialogue", "chat", "decisions"])
@pytest.mark.parametrize("failure", ["incomplete-body", "incomplete-error-body", "deep-json"])
def test_unexpected_exit_always_completes_admitted_request(kind, failure, monkeypatch):
    from dataclasses import replace
    from meowdiobooks.backend.remote_llm import remote_decisions_completion, RemoteModelUnavailableError

    completed = []
    admitted = []
    config = load_model_registry(ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "synthetic-key")

    class BrokenResponse(Response):
        def close(self):
            pass

        def read(self):
            if failure != "deep-json":
                raise http.client.IncompleteRead(b"partial")
            return b"[" * 10000

    def transport(*_args, **_kwargs):
        if failure == "incomplete-error-body":
            raise urllib.error.HTTPError("url", 503, "temporary", {}, BrokenResponse(None))
        return BrokenResponse(None)

    def admit(_config, metadata):
        admitted.append(metadata)
        return lambda event: completed.append(event)

    monkeypatch.setattr("urllib.request.urlopen", transport)
    monkeypatch.setattr('time.sleep', lambda _: None)
    with pytest.raises((http.client.IncompleteRead, RecursionError, RemoteModelUnavailableError)):
        if kind == "decisions":
            remote_decisions_completion(ROOT, replace(config, engine="openai_decisions"), "prompt", [],
                                       request_admission=admit)
        else:
            run(kind, monkeypatch, admit)
    expected = 4 if kind == 'decisions' and failure == 'incomplete-error-body' else 1
    assert len(admitted) == len(completed) == expected
    assert completed[0]["ambiguousBillable"] is True


def run(kind, monkeypatch, admission, observer=None):
    config = load_model_registry(ROOT).remote_dialogue_model()
    monkeypatch.setenv(config.api_key_env, "test-key")
    monkeypatch.setattr("time.sleep", lambda _: None)
    if kind == "dialogue":
        return _responses_api_call(config, "low", observer, request_admission=admission)(
            {"max_output_tokens": 100, "input": []}
        )
    return remote_chat_completion(ROOT, config, "system", "prompt",
                                  request_admission=admission, usage_observer=observer)


@pytest.mark.parametrize("kind", ["dialogue", "chat"])
@pytest.mark.parametrize("failure,outcome", [
    ("http", "http-error"), ("transport", "transport-error"),
    ("invalid", "invalid-response"),
])
def test_retry_completion_is_bound_to_exact_physical_request(kind, failure, outcome, monkeypatch):
    admissions = []
    completed = []
    observed = []
    calls = []

    def admit(_config, metadata):
        request_id = len(admissions)
        admissions.append(metadata)
        return lambda event: completed.append((request_id, event))

    def transport(*_args, **_kwargs):
        calls.append(True)
        if len(calls) == 1:
            if failure == "http":
                raise urllib.error.HTTPError("url", 429, "limited", {}, io.BytesIO(b"limited"))
            if failure == "transport":
                raise OSError("unknown delivery")
            return Response(b"invalid json")
        return Response(success())

    monkeypatch.setattr("urllib.request.urlopen", transport)
    run(kind, monkeypatch, admit, lambda _config, event: observed.append(event))
    assert len(calls) == 2
    assert [entry["attempt"] for entry in admissions] == [1, 2]
    assert [(index, event["attempt"], event["outcome"]) for index, event in completed] == [
        (0, 1, outcome), (1, 2, "response"),
    ]
    assert observed == [event for _, event in completed]
    assert completed[0][1]["ambiguousBillable"] is (failure != "http")


@pytest.mark.parametrize("kind", ["dialogue", "chat"])
def test_completion_storage_error_never_retries_billable_request(kind, monkeypatch):
    calls = []

    def transport(*_args, **_kwargs):
        calls.append(True)
        return Response(success())

    def complete(_event):
        raise OSError("receipt persistence failed")

    monkeypatch.setattr("urllib.request.urlopen", transport)
    with pytest.raises(OSError, match="receipt persistence"):
        run(kind, monkeypatch, lambda *_: complete)
    assert len(calls) == 1


@pytest.mark.parametrize("kind", ["dialogue", "chat"])
def test_denied_request_has_no_physical_request_or_completion(kind, monkeypatch):
    def deny(*_args):
        raise RuntimeError("budget denied")

    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: pytest.fail("sent"))
    with pytest.raises(RuntimeError, match="budget denied"):
        run(kind, monkeypatch, deny)


@pytest.mark.parametrize("kind", ["dialogue", "chat"])
def test_receipt_preserves_absent_reported_model_without_changing_display_model(kind, monkeypatch):
    events = []
    payload = json.loads(success())
    del payload["model"]
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs:
                        Response(json.dumps(payload).encode()))
    run(kind, monkeypatch, lambda *_args: events.append)
    assert events[0]["model"] == "gpt-6-luna"
    assert events[0]["reportedModel"] is None


@pytest.mark.parametrize("kind", ["dialogue", "chat"])
@pytest.mark.parametrize("reported_tier", ["fast", "default"])
def test_fast_service_tier_is_sent_and_actual_tier_observed(kind, reported_tier, monkeypatch):
    observed = []
    captured = []

    def transport(request, **_kwargs):
        captured.append(json.loads(request.data))
        payload = json.loads(success())
        payload["model"] = "gpt-6-luna"
        payload["service_tier"] = reported_tier
        return Response(json.dumps(payload).encode())

    monkeypatch.setattr("urllib.request.urlopen", transport)
    run(kind, monkeypatch, None, lambda _config, event: observed.append(event))
    assert captured[0]["model"] == "gpt-6-luna"
    assert captured[0]["service_tier"] == "fast"
    assert captured[0]["reasoning"]["effort"] == "low"
    assert observed[0]["serviceTier"] == reported_tier
