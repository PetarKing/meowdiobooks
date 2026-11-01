"""Small OpenAI-compatible transport for explicitly selected remote work."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any, TypedDict

from .model_config import RemoteTextModelConfig


class RemoteModelUnavailableError(RuntimeError):
    """A recoverable remote-model configuration or transport failure."""

    def __init__(self, message: str, *, public_message: str | None = None) -> None:
        super().__init__(message)
        self.public_message = public_message or message


RemoteUsageObserver = Callable[[RemoteTextModelConfig, Mapping[str, Any]], None]


class RemoteRequestMetadata(TypedDict):
    """Request bounds exposed without source text, credentials, or transport details."""

    model: str
    payloadBytes: int
    maximumOutputTokens: int
    attempt: int


# Versioned capability for hosted compositions consuming immutable releases.
REMOTE_REQUEST_COMPLETION_VERSION = 2
RemoteRequestCompletion = Callable[[Mapping[str, Any]], None]
RemoteRequestAdmission = Callable[
    [RemoteTextModelConfig, RemoteRequestMetadata], RemoteRequestCompletion | None
]


@contextmanager
def _request_completion_guard(config, observer, completion, attempt):
    """Every admitted physical request finishes once, including unexpected exits."""
    finished = False

    def finish(event):
        nonlocal finished
        if finished:
            return
        finished = True
        if completion is not None:
            completion(event)

    try:
        yield finish
    finally:
        if not finished:
            _observe_remote_call(
                config, observer, completion=finish, outcome="transport-error",
                attempt=attempt, ambiguous_billable=True,
            )


def admit_remote_request(
    config: RemoteTextModelConfig,
    admission: RemoteRequestAdmission | None,
    *,
    payload_bytes: int,
    max_output_tokens: object,
    attempt: int,
) -> RemoteRequestCompletion | None:
    """Validate finite request bounds and let a composition deny a physical request.

    Call outside transport exception handling on every attempt, including retries.
    Admission exceptions propagate unchanged and must never trigger a provider retry.
    An optional returned callback receives this physical request's final outcome.
    Completion exceptions also propagate without retrying already-performed work.
    """

    if type(max_output_tokens) is not int or max_output_tokens <= 0:
        raise ValueError("Remote requests require a positive integer maximum output token count")
    if admission is not None:
        return admission(config, {
            "model": config.model,
            "payloadBytes": payload_bytes,
            "maximumOutputTokens": max_output_tokens,
            "attempt": attempt,
        })


def configured_api_key(repo_root: Path, variable: str) -> str | None:
    """Read one configured secret from the environment or the repository-local dotenv file."""

    value = os.environ.get(variable)
    if value:
        return value
    path = repo_root / ".env"
    if not path.is_file():
        return None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, candidate = line.split("=", 1)
        if key.strip() != variable:
            continue
        candidate = candidate.strip()
        if len(candidate) >= 2 and candidate[0] == candidate[-1] and candidate[0] in {'"', "'"}:
            candidate = candidate[1:-1]
        return candidate or None
    return None


def remote_chat_completion(
    repo_root: Path,
    config: RemoteTextModelConfig,
    system: str,
    prompt: str,
    *,
    max_completion_tokens: int = 4096,
    usage_observer: RemoteUsageObserver | None = None,
    response_schema: Mapping[str, Any] | None = None,
    request_admission: RemoteRequestAdmission | None = None,
) -> dict[str, Any]:
    """Run one bounded remote request without persisting the credential or source passage."""

    key = configured_api_key(repo_root, config.api_key_env)
    if not key:
        raise RemoteModelUnavailableError(
            f"{config.display_name} is not configured. Add {config.api_key_env} and try again."
        )
    if config.engine == "openai_responses":
        payload: dict[str, Any] = {
            "model": config.model,
            "instructions": system,
            "input": prompt,
            "max_output_tokens": max_completion_tokens,
            "store": False,
        }
        if config.reasoning_effort:
            payload["reasoning"] = {"effort": config.reasoning_effort}
        if response_schema is not None:
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": _schema_name(response_schema),
                    "strict": True,
                    "schema": dict(response_schema),
                }
            }
        endpoint = f"{config.base_url}/responses"
    else:
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_completion_tokens": max_completion_tokens,
        }
        if config.reasoning_effort:
            payload["reasoning_effort"] = config.reasoning_effort
        endpoint = f"{config.base_url}/chat/completions"
    if config.service_tier:
        payload["service_tier"] = config.service_tier
    if type(max_completion_tokens) is not int or max_completion_tokens <= 0:
        raise ValueError("Remote requests require a positive integer maximum output token count")
    output_budget = max_completion_tokens
    maximum_output_budget = max(max_completion_tokens, 2_048)
    last_error = ""
    for attempt, delay in enumerate((2, 5, 10, 0), 1):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=encoded,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        completion = admit_remote_request(
            config,
            request_admission,
            payload_bytes=len(encoded),
            max_output_tokens=output_budget,
            attempt=attempt,
        )
        with _request_completion_guard(config, usage_observer, completion, attempt) as completion:
            try:
                raw_response = urllib.request.urlopen(request, timeout=600).read()
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:1000]
                last_error = f"HTTP {error.code}: {detail}"
                _observe_remote_call(
                    config,
                    usage_observer,
                    completion=completion,
                    outcome="http-error",
                    attempt=attempt,
                    ambiguous_billable=error.code in {408, 500, 502, 503, 504},
                    http_status=error.code,
                )
                if error.code not in {429, 500, 502, 503, 504} or not delay:
                    break
            except (OSError, urllib.error.URLError) as error:
                last_error = f"{type(error).__name__}: {error}"
                _observe_remote_call(
                    config,
                    usage_observer,
                    completion=completion,
                    outcome="transport-error",
                    attempt=attempt,
                    ambiguous_billable=True,
                )
                if not delay:
                    break
            except BaseException:
                _observe_remote_call(
                    config, usage_observer, completion=completion, outcome="transport-error",
                    attempt=attempt, ambiguous_billable=True,
                )
                raise
            else:
                try:
                    response = json.loads(raw_response)
                except (ValueError, TypeError) as error:
                    last_error = f"{type(error).__name__}: {error}"
                    _observe_remote_call(
                        config,
                        usage_observer,
                        completion=completion,
                        outcome="invalid-response",
                        attempt=attempt,
                        ambiguous_billable=True,
                    )
                    if not delay:
                        break
                    time.sleep(delay)
                    continue
                usage = response.get("usage", {}) if isinstance(response, Mapping) else {}
                model = (
                    str(response.get("model") or config.model)
                    if isinstance(response, Mapping)
                    else config.model
                )
                _observe_remote_call(
                    config,
                    usage_observer,
                    completion=completion,
                    outcome="response",
                    attempt=attempt,
                    ambiguous_billable=not bool(usage),
                    model=model,
                    reported_model=response.get("model") if isinstance(response, Mapping) else None,
                    service_tier=response.get("service_tier") if isinstance(response, Mapping) else None,
                    usage=usage if isinstance(usage, Mapping) else {},
                )
                try:
                    if config.engine == "openai_responses" and response.get("status") == "incomplete":
                        details = response.get("incomplete_details")
                        reason = details.get("reason") if isinstance(details, Mapping) else None
                        # Reasoning shares the output allowance. Only the provider's
                        # explicit limit signal permits a larger, newly admitted retry.
                        # Never publish partial structured output, even if it parses.
                        refused = any(
                            isinstance(part, Mapping) and part.get("type") == "refusal"
                            for item in response.get("output", [])
                            if isinstance(item, Mapping)
                            for part in item.get("content", [])
                        )
                        if reason == "max_output_tokens" and not refused and delay:
                            output_budget = min(
                                maximum_output_budget, max(1_024, output_budget * 2)
                            )
                            payload["max_output_tokens"] = output_budget
                        raise ValueError(f"response was incomplete (reason={reason})")
                    content = (
                        _responses_output_text(response)
                        if config.engine == "openai_responses"
                        else str(response["choices"][0]["message"]["content"] or "").strip()
                    )
                    if not content:
                        raise ValueError("response was empty")
                except (KeyError, TypeError, ValueError) as error:
                    last_error = f"{type(error).__name__}: {error}"
                    if not delay:
                        break
                else:
                    return {
                        "text": content,
                        "usage": dict(usage),
                        "model": model,
                        "attempts": attempt,
                        "serviceTier": response.get("service_tier"),
                        "responseStatus": response.get("status"),
                    }
            time.sleep(delay)
    raise RemoteModelUnavailableError(
        f"{config.display_name} could not complete this speaker check. {last_error}",
        public_message=(
            "The hosted speaker check was interrupted. Try again; "
            "accepted work is unchanged."
        ),
    )


def _schema_name(schema: Mapping[str, Any]) -> str:
    """Return a stable Responses API name without leaking schema details."""

    title = str(schema.get("title") or "structured_response")
    normalized = "".join(character if character.isalnum() else "_" for character in title)
    return normalized.strip("_")[:64] or "structured_response"


def _observe_remote_call(
    config: RemoteTextModelConfig,
    observer: RemoteUsageObserver | None,
    *,
    outcome: str,
    attempt: int,
    ambiguous_billable: bool,
    model: str | None = None,
    usage: Mapping[str, Any] | None = None,
    http_status: int | None = None,
    completion: RemoteRequestCompletion | None = None,
    reported_model: str | None = None,
    service_tier: str | None = None,
) -> None:
    event = {
        "outcome": outcome,
        "attempt": attempt,
        "model": model or config.model,
        "reportedModel": reported_model,
        "serviceTier": service_tier,
        "usage": dict(usage or {}),
        "ambiguousBillable": ambiguous_billable,
        "httpStatus": http_status,
    }
    if completion is not None:
        completion(event)
    if observer is not None:
        observer(config, event)


def _responses_output_text(response: Mapping[str, Any]) -> str:
    """Extract assistant text from a raw Responses API result."""

    parts: list[str] = []
    output = response.get("output")
    if not isinstance(output, list):
        raise ValueError("response output was missing")
    for item in output:
        if not isinstance(item, Mapping) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, Mapping) and part.get("type") == "output_text":
                parts.append(str(part.get("text") or ""))
    return "".join(parts).strip()


def remote_token_prices(
    config: RemoteTextModelConfig,
    input_tokens: int,
    *,
    service_tier: str | None = None,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Return per-million input, cache-read, cache-write and output prices for one request.

    Missing response tiers use configured rates for estimates; settlement callers may instead
    retain a reservation until the provider reports its actual tier. Fast and priority are aliases.
    Long-context prices apply to the entire request, not just tokens above the threshold.
    """
    tier = service_tier or getattr(config, "service_tier", None)
    if tier not in {None, "default", "fast", "priority"}:
        raise ValueError(f"Unsupported reported service tier: {tier}")
    prefix = (
        "long_context_"
        if getattr(config, "long_context_input_token_threshold", None) is not None
        and input_tokens > config.long_context_input_token_threshold else ""
    )
    rates = tuple(
        Decimal(str(getattr(config, f"{prefix}{kind}_usd_per_million_tokens")))
        for kind in ("input", "cached_input", "cache_write_input", "output")
    )
    multiplier = (
        Decimal(str(getattr(config, "default_service_tier_price_multiplier", 1.0)))
        if tier == "default" else Decimal(1)
    )
    return tuple(rate * multiplier for rate in rates)


def remote_usage_cost(
    config: RemoteTextModelConfig,
    usage: Mapping[str, Any],
    *,
    service_tier: str | None = None,
) -> float:
    """Estimate one request from its provider token classes and actual response tier."""
    prompt = int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0)
    completion = int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0)
    prompt_details = usage.get("prompt_tokens_details", usage.get("input_tokens_details"))
    cached = (
        int(prompt_details.get("cached_tokens", 0) or 0)
        if isinstance(prompt_details, Mapping) else 0
    )
    cache_write = (
        int(prompt_details.get("cache_write_tokens", prompt_details.get("cache_creation_tokens", 0)) or 0)
        if isinstance(prompt_details, Mapping) else 0
    )
    uncached = max(0, prompt - cached - cache_write)
    rates = remote_token_prices(config, prompt, service_tier=service_tier)
    return float(sum(count * rate for count, rate in zip(
        (uncached, cached, cache_write, completion), rates, strict=True
    )) / 1_000_000)


def remote_decisions_completion(
    repo_root: Path,
    config: RemoteTextModelConfig,
    prompt: str,
    questions: list[dict[str, Any]],
    *,
    usage_observer: RemoteUsageObserver | None = None,
    request_admission: RemoteRequestAdmission | None = None,
) -> dict[str, Any]:
    """Run a bounded Decisions request through the same admission/settlement contract.

    Decisions has no generated output tokens. The positive one-token admission bound keeps
    compatibility with compositions requiring finite positive reservations; settlement receives
    the provider's actual zero output usage. Invalid/missing answers are never interpreted here.
    """
    if config.model != "gpt-6-luna":
        raise ValueError("Cleanup Decisions requires gpt-6-luna")
    key = configured_api_key(repo_root, config.api_key_env)
    if not key:
        raise RemoteModelUnavailableError(
            f"{config.display_name} is not configured. Add {config.api_key_env} and try again."
        )
    encoded = json.dumps({
        "model": config.model, "input": prompt, "questions": questions,
    }, ensure_ascii=False).encode("utf-8")
    for attempt, delay in enumerate((2, 5, 10, 0), 1):
        completion = admit_remote_request(
            config, request_admission, payload_bytes=len(encoded), max_output_tokens=1,
            attempt=attempt,
        )
        with _request_completion_guard(config, usage_observer, completion, attempt) as completion:
            request = urllib.request.Request(
                f"{config.base_url}/decisions", data=encoded,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                method="POST",
            )
            try:
                raw = urllib.request.urlopen(request, timeout=90).read()
            except urllib.error.HTTPError as error:
                _observe_remote_call(
                    config, usage_observer, completion=completion, outcome="http-error",
                    attempt=attempt, ambiguous_billable=error.code in {408, 500, 502, 503, 504},
                    http_status=error.code,
                )
                if error.code not in {429, 500, 502, 503, 504} or not delay:
                    break
            except (OSError, urllib.error.URLError):
                _observe_remote_call(
                    config, usage_observer, completion=completion, outcome="transport-error",
                    attempt=attempt, ambiguous_billable=True,
                )
                if not delay:
                    break
            else:
                try:
                    response = json.loads(raw)
                    if not isinstance(response, dict):
                        raise ValueError("Expected an object")
                except (ValueError, TypeError):
                    _observe_remote_call(
                        config, usage_observer, completion=completion, outcome="invalid-response",
                        attempt=attempt, ambiguous_billable=True,
                    )
                    # A malformed successful response might have been billed. Fail explicitly rather
                    # than charging again for a schema error that retrying cannot reliably resolve.
                    break
                usage = response.get("usage")
                _observe_remote_call(
                    config, usage_observer, completion=completion, outcome="response",
                    attempt=attempt, ambiguous_billable=not isinstance(usage, Mapping) or not usage,
                    model=str(response.get("model") or config.model),
                    reported_model=response.get("model"), service_tier=response.get("service_tier"),
                    usage=usage if isinstance(usage, Mapping) else {},
                )
                return response
            if delay:
                time.sleep(delay)
    raise RemoteModelUnavailableError(
        "The cleanup Decisions check was interrupted. Try again; accepted work is unchanged."
    )
