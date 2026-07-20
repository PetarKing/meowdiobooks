"""Small OpenAI-compatible transport for explicitly selected remote work."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from .model_config import RemoteTextModelConfig


class RemoteModelUnavailableError(RuntimeError):
    """A recoverable remote-model configuration or transport failure."""

    def __init__(self, message: str, *, public_message: str | None = None) -> None:
        super().__init__(message)
        self.public_message = public_message or message


RemoteUsageObserver = Callable[[RemoteTextModelConfig, Mapping[str, Any]], None]


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
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    last_error = ""
    for attempt, delay in enumerate((2, 5, 10, 0), 1):
        request = urllib.request.Request(
            endpoint,
            data=encoded,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            raw_response = urllib.request.urlopen(request, timeout=600).read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            last_error = f"HTTP {error.code}: {detail}"
            _observe_remote_call(
                config,
                usage_observer,
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
                outcome="transport-error",
                attempt=attempt,
                ambiguous_billable=True,
            )
            if not delay:
                break
        else:
            try:
                response = json.loads(raw_response)
            except (json.JSONDecodeError, TypeError) as error:
                last_error = f"{type(error).__name__}: {error}"
                _observe_remote_call(
                    config,
                    usage_observer,
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
                outcome="response",
                attempt=attempt,
                ambiguous_billable=not bool(usage),
                model=model,
                usage=usage if isinstance(usage, Mapping) else {},
            )
            try:
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
                }
        time.sleep(delay)
    raise RemoteModelUnavailableError(
        f"{config.display_name} could not complete this speaker check. {last_error}",
        public_message=(
            "The hosted speaker check was interrupted. Try again; "
            "accepted work is unchanged."
        ),
    )


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
) -> None:
    if observer is None:
        return
    observer(
        config,
        {
            "outcome": outcome,
            "attempt": attempt,
            "model": model or config.model,
            "usage": dict(usage or {}),
            "ambiguousBillable": ambiguous_billable,
            "httpStatus": http_status,
        },
    )


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


def remote_usage_cost(config: RemoteTextModelConfig, usage: Mapping[str, Any]) -> float:
    """Estimate provider cost from the token classes present in the response usage."""

    prompt = int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0)
    completion = int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0)
    prompt_details = usage.get("prompt_tokens_details", usage.get("input_tokens_details"))
    cached = (
        int(prompt_details.get("cached_tokens", 0) or 0)
        if isinstance(prompt_details, Mapping)
        else 0
    )
    uncached = max(0, prompt - cached)
    return (
        uncached * config.input_usd_per_million_tokens
        + cached * config.cached_input_usd_per_million_tokens
        + completion * config.output_usd_per_million_tokens
    ) / 1_000_000
