"""Small OpenAI-compatible transport for explicitly selected remote work."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .model_config import RemoteTextModelConfig


class RemoteModelUnavailableError(RuntimeError):
    """A recoverable remote-model configuration or transport failure."""


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
            response = json.loads(urllib.request.urlopen(request, timeout=600).read())
            content = (
                _responses_output_text(response)
                if config.engine == "openai_responses"
                else str(response["choices"][0]["message"]["content"] or "").strip()
            )
            if not content:
                raise ValueError("response was empty")
            return {
                "text": content,
                "usage": dict(response.get("usage", {})),
                "model": str(response.get("model") or config.model),
                "attempts": attempt,
            }
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            last_error = f"HTTP {error.code}: {detail}"
            if error.code not in {429, 500, 502, 503, 504} or not delay:
                break
        except (OSError, urllib.error.URLError, KeyError, TypeError, ValueError) as error:
            last_error = f"{type(error).__name__}: {error}"
            if not delay:
                break
        time.sleep(delay)
    raise RemoteModelUnavailableError(
        f"{config.display_name} could not complete this speaker check. {last_error}"
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
