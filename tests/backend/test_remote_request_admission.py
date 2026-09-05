"""Admission belongs to each physical request, independently of transport retries."""

import io
import json
import urllib.error
from dataclasses import replace
from pathlib import Path

import pytest

from meowdiobooks.backend import dialogue_remote, remote_llm
from meowdiobooks.backend.model_config import load_model_registry


REPO_ROOT = Path(__file__).resolve().parents[2]


class Response:
    def __init__(self, body):
        self.body = body

    def read(self):
        return json.dumps(self.body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


@pytest.fixture(params=["responses", "chat", "dialogue-tools"])
def transport(request, monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    monkeypatch.setenv(config.api_key_env, "test-key")
    monkeypatch.setattr(remote_llm, "configured_api_key", lambda *_args: "test-key")
    if request.param == "chat":
        config = replace(config, engine="openai_compatible")

    def invoke(admission=None, max_tokens=64):
        if request.param == "dialogue-tools":
            call = dialogue_remote._responses_api_call(
                config, "medium", None, request_admission=admission
            )
            return call({"input": "中文 evidence", "max_output_tokens": max_tokens})
        return remote_llm.remote_chat_completion(
            REPO_ROOT, config, "system", "中文 evidence",
            max_completion_tokens=max_tokens, request_admission=admission,
        )

    body = {
        "model": config.model,
        "usage": {"input_tokens": 5, "output_tokens": 1},
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}],
        "choices": [{"message": {"content": "ok"}}],
    }
    return config, invoke, body


def test_denial_prevents_network_even_for_transport_shaped_exception(transport, monkeypatch):
    config, invoke, _body = transport
    attempts = []
    failure = OSError("request disallowed")

    def deny(observed_config, metadata):
        assert observed_config is config
        assert metadata["model"] == config.model
        assert metadata["payloadBytes"] > 0
        assert metadata["maximumOutputTokens"] == 64
        attempts.append(metadata)
        raise failure

    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: pytest.fail("network used"))
    monkeypatch.setattr(remote_llm.time, "sleep", lambda *_a: pytest.fail("denial retried"))
    with pytest.raises(OSError) as raised:
        invoke(deny)
    assert raised.value is failure
    assert len(attempts) == 1


def test_each_retry_is_admitted_with_exact_serialized_request_size(transport, monkeypatch):
    config, invoke, body = transport
    events = []
    admitted = []
    wire = []

    def admit(observed_config, metadata):
        assert observed_config is config
        events.append("admit")
        admitted.append(metadata)

    def send(request, timeout):
        assert timeout == 600
        events.append("network")
        wire.append(request.data)
        if len(wire) == 1:
            raise urllib.error.HTTPError(request.full_url, 503, "retry", None, io.BytesIO(b""))
        return Response(body)

    monkeypatch.setattr("urllib.request.urlopen", send)
    monkeypatch.setattr(remote_llm.time, "sleep", lambda *_a: None)
    invoke(admit)
    assert events == ["admit", "network", "admit", "network"]
    assert [item["attempt"] for item in admitted] == [1, 2]
    assert [item["payloadBytes"] for item in admitted] == [len(data) for data in wire]
    assert all(item["maximumOutputTokens"] == 64 for item in admitted)
    assert all(set(item) == {"model", "payloadBytes", "maximumOutputTokens", "attempt"} for item in admitted)


def test_retry_can_be_denied_after_an_earlier_network_attempt(transport, monkeypatch):
    _config, invoke, _body = transport
    attempts = []
    network = []

    def admit(_config, metadata):
        attempts.append(metadata)
        if len(attempts) == 2:
            raise urllib.error.URLError("retry disallowed")

    def send(request, timeout):
        network.append(request)
        raise urllib.error.HTTPError(request.full_url, 503, "retry", None, io.BytesIO(b""))

    monkeypatch.setattr("urllib.request.urlopen", send)
    monkeypatch.setattr(remote_llm.time, "sleep", lambda *_a: None)
    with pytest.raises(urllib.error.URLError, match="retry disallowed"):
        invoke(admit)
    assert len(attempts) == 2
    assert len(network) == 1


@pytest.mark.parametrize("maximum", [None, 0, -1, True, 1.5, float("inf"), float("nan"), "64"])
def test_unbounded_or_invalid_output_is_rejected_before_admission(transport, monkeypatch, maximum):
    _config, invoke, _body = transport
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: pytest.fail("network used"))
    with pytest.raises(ValueError, match="positive integer"):
        invoke(lambda *_a: pytest.fail("invalid request admitted"), max_tokens=maximum)


def test_no_hook_still_sends_request(transport, monkeypatch):
    _config, invoke, body = transport
    sent = []

    def send(request, timeout):
        sent.append(request)
        return Response(body)

    monkeypatch.setattr("urllib.request.urlopen", send)
    invoke()
    assert len(sent) == 1
