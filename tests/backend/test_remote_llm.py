import io
import json
import urllib.error
from pathlib import Path
from dataclasses import replace

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
                "model": "gpt-6-luna",
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
        "model": "gpt-6-luna",
        "instructions": "system rules",
        "input": "source passage",
        "max_output_tokens": 500,
        "store": False,
        "reasoning": {"effort": "low"},
        "service_tier": "fast",
    }
    assert result["text"] == "T001|D|Alice"
    assert result["usage"]["input_tokens"] == 100
    assert remote_usage_cost(config, result["usage"]) == pytest.approx(0.0000264)
    assert observed == [
        (
            config,
            {
                "outcome": "response",
                "attempt": 1,
                "model": "gpt-6-luna",
                "reportedModel": "gpt-6-luna",
                "serviceTier": None,
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
    assert config.pricing_version == "openai-gpt-6-luna-fast-2026-10-07"


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


def test_luna_prices_cache_write_tokens_separately():
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None

    usage = {
        "input_tokens": 1_000,
        "input_tokens_details": {
            "cached_tokens": 200,
            "cache_write_tokens": 300,
        },
        "output_tokens": 100,
    }

    assert remote_usage_cost(config, usage) == pytest.approx(0.000279)


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


@pytest.mark.parametrize("input_tokens,tier,expected", [
    (272_000, "fast", 0.0554),
    (272_001, "fast", 0.1103004),
    (272_001, "priority", 0.1103004),
    (272_000, "default", 0.0277),
    (272_001, "default", 0.0551502),
])
def test_luna_request_pricing_obeys_actual_tier_and_long_context_boundary(input_tokens, tier, expected):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    usage = {"input_tokens": input_tokens, "output_tokens": 1_000}
    assert remote_usage_cost(config, usage, service_tier=tier) == pytest.approx(expected)


def test_luna_rejects_unknown_reported_tier_instead_of_silently_mispricing():
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    with pytest.raises(ValueError, match="Unsupported reported service tier"):
        remote_usage_cost(config, {"input_tokens": 10}, service_tier="future-tier")


def test_luna_prices_long_context_cache_classes_and_creation_alias():
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    usage = {
        "input_tokens": 300_000,
        "input_tokens_details": {"cached_tokens": 100_000, "cache_creation_tokens": 100_000},
        "output_tokens": 10_000,
    }
    assert remote_usage_cost(config, usage, service_tier="fast") == pytest.approx(0.109)
    assert remote_usage_cost(config, usage, service_tier="default") == pytest.approx(0.0545)


@pytest.mark.parametrize("engine", ["openai_responses", "openai_compatible"])
def test_existing_profiles_without_service_tier_do_not_send_one(engine, monkeypatch):
    config = replace(load_model_registry(REPO_ROOT).remote_dialogue_model(),
                     engine=engine, service_tier=None)
    captured = []

    def transport(request, **_kwargs):
        captured.append(json.loads(request.data))
        return _Response({
            "model": config.model, "usage": {},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}],
            "choices": [{"message": {"content": "ok"}}],
        })

    monkeypatch.setenv(config.api_key_env, "test-key")
    monkeypatch.setattr("urllib.request.urlopen", transport)
    assert remote_chat_completion(REPO_ROOT, config, "system", "prompt")["text"] == "ok"
    assert "service_tier" not in captured[0]


@pytest.mark.parametrize("partial_text", ["", '{"relationship":"same"}'])
def test_output_limit_retries_with_reasoning_headroom_and_new_admission(monkeypatch, partial_text):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    requests, admitted, observed = [], [], []
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.configured_api_key", lambda *_: "test-key")
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda _: None)

    def open_response(request, timeout):
        requests.append(json.loads(request.data))
        limited = len(requests) == 1
        return _Response({
            "model": config.model,
            "status": "incomplete" if limited else "completed",
            "incomplete_details": {"reason": "max_output_tokens"} if limited else None,
            "output": [{"type": "message", "content": [{
                "type": "output_text", "text": partial_text if limited else "final decision",
            }]}],
            "usage": {"input_tokens": 100, "output_tokens": 384 if limited else 500},
        })

    monkeypatch.setattr("urllib.request.urlopen", open_response)
    result = remote_chat_completion(
        REPO_ROOT, config, "system", "prompt", max_completion_tokens=384,
        request_admission=lambda _, metadata: admitted.append(metadata),
        usage_observer=lambda _, event: observed.append(event),
    )
    assert result["text"] == "final decision"
    assert result["attempts"] == 2
    assert [request["max_output_tokens"] for request in requests] == [384, 1024]
    assert [metadata["maximumOutputTokens"] for metadata in admitted] == [384, 1024]
    assert [metadata["attempt"] for metadata in admitted] == [1, 2]
    assert [event["usage"]["output_tokens"] for event in observed] == [384, 500]


@pytest.mark.parametrize("status, reason, refusal", [
    ("completed", None, False),
    ("completed", None, True),
    ("incomplete", "content_filter", False),
    ("incomplete", "max_output_tokens", True),
])
def test_empty_refused_and_other_incomplete_responses_never_raise_budget(monkeypatch, status, reason, refusal):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    budgets = []
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.configured_api_key", lambda *_: "test-key")
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda _: None)

    def open_response(request, timeout):
        budgets.append(json.loads(request.data)["max_output_tokens"])
        return _Response({
            "status": status, "incomplete_details": {"reason": reason},
            "output": [{"type": "message", "content": [
                {"type": "refusal", "refusal": "Cannot decide"} if refusal else
                {"type": "output_text", "text": ""},
            ]}],
        })

    monkeypatch.setattr("urllib.request.urlopen", open_response)
    with pytest.raises(RemoteModelUnavailableError):
        remote_chat_completion(REPO_ROOT, config, "system", "prompt", max_completion_tokens=384)
    assert budgets == [384] * 4


@pytest.mark.parametrize("initial, expected", [(384, [384, 1024, 2048, 2048]), (4096, [4096] * 4)])
def test_output_limit_exhaustion_keeps_attempt_and_budget_bounds(monkeypatch, initial, expected):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    admitted = []
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.configured_api_key", lambda *_: "test-key")
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda _: None)
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: _Response({
        "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"},
        "output": [],
    }))
    with pytest.raises(RemoteModelUnavailableError, match="incomplete.*max_output_tokens") as caught:
        remote_chat_completion(
            REPO_ROOT, config, "system", "prompt", max_completion_tokens=initial,
            request_admission=lambda _, metadata: admitted.append(metadata["maximumOutputTokens"]),
        )
    assert admitted == expected
    assert caught.value.public_message == (
        "The hosted speaker check was interrupted. Try again; accepted work is unchanged."
    )


def test_larger_output_retry_requires_new_admission_before_network(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    requests, admitted, completed = [], [], []
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.configured_api_key", lambda *_: "test-key")
    monkeypatch.setattr("meowdiobooks.backend.remote_llm.time.sleep", lambda _: None)

    def admit(_, metadata):
        admitted.append(metadata["maximumOutputTokens"])
        if len(admitted) == 2:
            raise RuntimeError("Larger request denied")
        return completed.append

    def open_response(request, timeout):
        requests.append(json.loads(request.data))
        return _Response({
            "model": config.model, "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"}, "output": [],
            "usage": {"input_tokens": 100, "output_tokens": 384},
        })

    monkeypatch.setattr("urllib.request.urlopen", open_response)
    with pytest.raises(RuntimeError, match="Larger request denied"):
        remote_chat_completion(
            REPO_ROOT, config, "system", "prompt", max_completion_tokens=384,
            request_admission=admit,
        )
    assert admitted == [384, 1024]
    assert len(requests) == 1
    assert len(completed) == 1
    assert completed[0]["usage"]["output_tokens"] == 384
