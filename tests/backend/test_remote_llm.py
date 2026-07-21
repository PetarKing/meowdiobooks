import io
import json
import urllib.error
from pathlib import Path

import pytest

from meowdiobooks.backend.model_config import load_model_registry
from meowdiobooks.backend.remote_llm import (
    RemoteModelUnavailableError,
    remote_chat_completion,
    remote_usage_cost,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_luna_uses_responses_without_remote_state_storage(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    captured = {}
    observed = []

    def open_response(request, timeout):
        captured["url"] = request.full_url
        captured["payload"] = json.loads(request.data)
        captured["timeout"] = timeout
        return _Response(
            {
                "model": "gpt-5.6-luna",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "T001|D|Alice"}],
                    }
                ],
                "usage": {
                    "input_tokens": 100,
                    "input_tokens_details": {"cached_tokens": 20},
                    "output_tokens": 10,
                },
            }
        )

    monkeypatch.setattr(
        "meowdiobooks.backend.remote_llm.configured_api_key",
        lambda *_args: "test-key",
    )
    monkeypatch.setattr("urllib.request.urlopen", open_response)

    result = remote_chat_completion(
        REPO_ROOT,
        config,
        "system rules",
        "source passage",
        max_completion_tokens=500,
        usage_observer=lambda observed_config, event: observed.append(
            (observed_config, event)
        ),
    )

    assert captured["url"] == "https://api.openai.com/v1/responses"
    assert captured["payload"] == {
        "model": "gpt-5.6-luna",
        "instructions": "system rules",
        "input": "source passage",
        "max_output_tokens": 500,
        "store": False,
        "reasoning": {"effort": "low"},
    }
    assert result["text"] == "T001|D|Alice"
    assert result["usage"]["input_tokens"] == 100
    assert remote_usage_cost(config, result["usage"]) == pytest.approx(0.000142)
    assert observed == [
        (
            config,
            {
                "outcome": "response",
                "attempt": 1,
                "model": "gpt-5.6-luna",
                "usage": {
                    "input_tokens": 100,
                    "input_tokens_details": {"cached_tokens": 20},
                    "output_tokens": 10,
                },
                "ambiguousBillable": False,
                "httpStatus": None,
            },
        )
    ]
    assert config.pricing_version == "openai-gpt-5.6-luna-2026-07-18"


def test_luna_uses_native_strict_structured_outputs_when_schema_is_supplied(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    captured = {}
    schema = {
        "title": "voice profile/v4",
        "type": "object",
        "properties": {"tone": {"type": "string"}},
        "required": ["tone"],
        "additionalProperties": False,
    }

    def open_response(request, timeout):
        assert timeout == 600
        captured["payload"] = json.loads(request.data)
        return _Response(
            {
                "model": config.model,
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": '{"tone":"warm"}'}
                        ],
                    }
                ],
                "usage": {},
            }
        )

    monkeypatch.setattr(
        "meowdiobooks.backend.remote_llm.configured_api_key",
        lambda *_args: "test-key",
    )
    monkeypatch.setattr("urllib.request.urlopen", open_response)

    remote_chat_completion(
        REPO_ROOT,
        config,
        "system rules",
        "source passage",
        response_schema=schema,
    )

    assert captured["payload"]["text"] == {
        "format": {
            "type": "json_schema",
            "name": "voice_profile_v4",
            "strict": True,
            "schema": schema,
        }
    }


def test_usage_observer_sees_provider_usage_before_invalid_output_retry(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    responses = iter(
        [
            {
                "model": config.model,
                "output": [],
                "usage": {"input_tokens": 10, "output_tokens": 2},
            },
            {
                "model": config.model,
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "T001|D|Alice"}],
                    }
                ],
                "usage": {"input_tokens": 12, "output_tokens": 3},
            },
        ]
    )
    observed = []
    monkeypatch.setattr(
        "meowdiobooks.backend.remote_llm.configured_api_key",
        lambda *_args: "test-key",
    )
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *_args, **_kwargs: _Response(next(responses))
    )
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda *_args: None)

    result = remote_chat_completion(
        REPO_ROOT,
        config,
        "system rules",
        "source passage",
        usage_observer=lambda _config, event: observed.append(event),
    )

    assert result["text"] == "T001|D|Alice"
    assert [event["usage"] for event in observed] == [
        {"input_tokens": 10, "output_tokens": 2},
        {"input_tokens": 12, "output_tokens": 3},
    ]


def test_remote_failure_keeps_provider_diagnostics_out_of_public_message(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    raw_detail = b'{"error":"private provider diagnostics"}'

    def fail_request(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            400,
            "Bad request",
            hdrs=None,
            fp=io.BytesIO(raw_detail),
        )

    monkeypatch.setattr(
        "meowdiobooks.backend.remote_llm.configured_api_key",
        lambda *_args: "test-key",
    )
    monkeypatch.setattr("urllib.request.urlopen", fail_request)
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda *_args: None)

    with pytest.raises(RemoteModelUnavailableError) as raised:
        remote_chat_completion(REPO_ROOT, config, "system rules", "source passage")

    assert "private provider diagnostics" in str(raised.value)
    assert "private provider diagnostics" not in raised.value.public_message
    assert raised.value.public_message == (
        "The hosted speaker check was interrupted. Try again; "
        "accepted work is unchanged."
    )
