"""Optional JSON-Schema guidance for provider-neutral model completions."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping
from typing import Any


JsonCompletion = Callable[..., object]
JsonSchema = Mapping[str, Any]


def complete_with_schema(
    complete: JsonCompletion,
    system: str,
    prompt: str,
    max_tokens: int,
    response_schema: JsonSchema,
) -> object:
    """Pass a schema when the configured completion transport supports it."""

    try:
        parameters = inspect.signature(complete).parameters.values()
    except (TypeError, ValueError):
        return complete(system, prompt, max_tokens)
    supports_schema = any(
        parameter.name == "response_schema"
        or parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    )
    if supports_schema:
        return complete(
            system,
            prompt,
            max_tokens,
            response_schema=response_schema,
        )
    return complete(system, prompt, max_tokens)


def strict_object_schema(
    title: str,
    properties: Mapping[str, Any],
    *,
    required: list[str] | None = None,
) -> dict[str, Any]:
    """Build the strict object shape required by Responses Structured Outputs."""

    return {
        "title": title,
        "type": "object",
        "properties": dict(properties),
        "required": required or list(properties),
        "additionalProperties": False,
    }
