"""Pure planning and validation contracts for optional transcript enrichment.

This module deliberately has no model or storage dependencies.  A caller plans
bounded source windows, asks a model for decorators, and publishes the result
only after :func:`validate_enrichment_output` accepts the complete response.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class EnrichmentValidationError(ValueError):
    """The proposed enrichment cannot be published as a complete revision."""


class TurnState(StrEnum):
    NEUTRAL = "neutral"
    HAPPY = "happy"
    SAD = "sad"
    ANGRY = "angry"
    AFRAID = "afraid"
    SURPRISED = "surprised"
    DISGUSTED = "disgusted"
    EMBARRASSED = "embarrassed"
    DETERMINED = "determined"
    CONFUSED = "confused"
    PAINED = "pained"
    TENDER = "tender"


class RangeDecoratorKind(StrEnum):
    AMBIENCE = "ambience"
    EFFECT = "effect"


STATE_VALUES = tuple(state.value for state in TurnState)
RANGE_DECORATOR_KINDS = tuple(kind.value for kind in RangeDecoratorKind)
LOCKED_TURN_FIELDS = ("speakerId", "identityId")


@dataclass(frozen=True, slots=True)
class EnrichmentOptions:
    """Enabled decorators and hard limits for one enrichment run."""

    state: bool = True
    ambience: bool = False
    effects: bool = False
    max_input_tokens: int = 8_000
    max_output_rows: int = 400
    overlap_turns: int = 2
    seconds_per_window: int = 45

    @property
    def enabled(self) -> bool:
        return self.state or self.ambience or self.effects


def estimate_turn_tokens(turn: dict[str, Any]) -> int:
    """Return a deterministic conservative token estimate for a model input row."""

    text = str(turn.get("text", ""))
    metadata = " ".join(
        str(turn.get(key, "")) for key in ("id", "chapterId", "sceneId", "speakerId", "identityId")
    )
    # Four characters per token is a useful local planning approximation.  The
    # fixed overhead accounts for row delimiters and field names in the prompt.
    return max(1, math.ceil((len(text) + len(metadata)) / 4) + 8)


def plan_enrichment(
    turns: list[dict[str, Any]],
    options: EnrichmentOptions | None = None,
) -> dict[str, Any]:
    """Plan bounded contiguous model windows and a user-visible workload estimate.

    Turns must be in transcript order and have unique ``id`` values.  Windows
    never cross chapter boundaries.  Every turn belongs to exactly one window
    as an owner; neighboring turns may occur in other windows as context only.
    """

    selected = options or EnrichmentOptions()
    _validate_options(selected)
    normalized = _validate_turns(turns)
    if not selected.enabled:
        return _skip_plan(normalized, selected)

    windows: list[dict[str, Any]] = []
    for continuity_turns in _continuity_groups(normalized):
        windows.extend(_plan_contiguous_group(continuity_turns, selected, len(windows)))

    owner_ids = [turn_id for window in windows for turn_id in window["ownerTurnIds"]]
    expected_ids = [str(turn["id"]) for turn in normalized]
    if owner_ids != expected_ids:
        raise EnrichmentValidationError("Every transcript turn must have exactly one owning window")

    total_tokens = sum(int(window["estimatedInputTokens"]) for window in windows)
    estimated_seconds = len(windows) * selected.seconds_per_window
    return {
        "status": "planned",
        "options": _options_dict(selected),
        "windows": windows,
        "workload": {
            "totalTurns": len(normalized),
            "contextualWindows": len(windows),
            "estimatedInputTokens": total_tokens,
            "expectedTurnRows": len(normalized) if selected.state else 0,
            "estimatedSeconds": estimated_seconds,
            "estimatedDuration": _duration_range(estimated_seconds),
            "modelLoad": _model_load(total_tokens),
        },
        "downstream": _downstream_honesty(),
    }


def skipped_enrichment(
    dialogue_revision_id: str,
    cast_revision_id: str,
) -> dict[str, Any]:
    """Publish the explicit skip result without requiring a model or windows."""

    if not dialogue_revision_id or not cast_revision_id:
        raise EnrichmentValidationError("Skipped enrichment must reference Dialogue and Cast")
    return {
        "status": "skipped",
        "dialogueRevisionId": dialogue_revision_id,
        "castRevisionId": cast_revision_id,
        "turnStates": [],
        "rangeDecorators": [],
        "downstream": _downstream_honesty(),
    }


def validate_enrichment_output(
    turns: list[dict[str, Any]],
    plan: dict[str, Any],
    output: dict[str, Any],
    *,
    dialogue_revision_id: str,
    cast_revision_id: str,
) -> dict[str, Any]:
    """Validate a complete model result and return a publishable artifact.

    Validation is transactional: this function constructs no partial result.
    Any missing, duplicate, invented, reordered or identity-mutating row raises
    :class:`EnrichmentValidationError`.
    """

    normalized = _validate_turns(turns)
    if plan.get("status") != "planned":
        raise EnrichmentValidationError("Only a planned enrichment run accepts model output")
    if not dialogue_revision_id or not cast_revision_id:
        raise EnrichmentValidationError("Enrichment must reference accepted Dialogue and Cast")

    options = plan.get("options")
    if not isinstance(options, dict):
        raise EnrichmentValidationError("Enrichment plan has no valid options")
    _validate_plan_ownership(normalized, plan)

    states = output.get("turnStates", [])
    ranges = output.get("rangeDecorators", [])
    if not isinstance(states, list) or not isinstance(ranges, list):
        raise EnrichmentValidationError("Decorator output rows must be lists")

    validated_states = _validate_state_rows(normalized, states, bool(options.get("state")))
    validated_ranges = _validate_range_rows(
        normalized,
        ranges,
        ambience=bool(options.get("ambience")),
        effects=bool(options.get("effects")),
    )

    return {
        "status": "complete",
        "dialogueRevisionId": dialogue_revision_id,
        "castRevisionId": cast_revision_id,
        "turnStates": validated_states,
        "rangeDecorators": validated_ranges,
        "downstream": _downstream_honesty(),
    }


def _validate_options(options: EnrichmentOptions) -> None:
    if options.max_input_tokens < 1:
        raise EnrichmentValidationError("max_input_tokens must be positive")
    if options.max_output_rows < 1:
        raise EnrichmentValidationError("max_output_rows must be positive")
    if options.overlap_turns < 0:
        raise EnrichmentValidationError("overlap_turns cannot be negative")
    if options.seconds_per_window < 0:
        raise EnrichmentValidationError("seconds_per_window cannot be negative")


def _validate_turns(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, turn in enumerate(turns):
        if not isinstance(turn, dict):
            raise EnrichmentValidationError(f"Turn {index} is not an object")
        turn_id = str(turn.get("id", "")).strip()
        if not turn_id:
            raise EnrichmentValidationError(f"Turn {index} has no id")
        if turn_id in seen:
            raise EnrichmentValidationError(f"Duplicate transcript turn id: {turn_id}")
        if "text" not in turn:
            raise EnrichmentValidationError(f"Turn {turn_id} has no text")
        seen.add(turn_id)
        normalized.append(turn)
    return normalized


def _continuity_groups(turns: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Keep model windows inside an explicit scene, or otherwise a chapter."""

    groups: list[list[dict[str, Any]]] = []
    for turn in turns:
        key = _continuity_key(turn)
        if not groups or _continuity_key(groups[-1][0]) != key:
            groups.append([turn])
        else:
            groups[-1].append(turn)
    return groups


def _continuity_key(turn: dict[str, Any]) -> tuple[str, str | None]:
    chapter_id = str(turn.get("chapterId", "book"))
    scene = turn.get("sceneId")
    return chapter_id, str(scene) if scene is not None else None


def _plan_contiguous_group(
    turns: list[dict[str, Any]],
    options: EnrichmentOptions,
    window_offset: int,
) -> list[dict[str, Any]]:
    token_costs = [estimate_turn_tokens(turn) for turn in turns]
    for turn, cost in zip(turns, token_costs, strict=True):
        if cost > options.max_input_tokens:
            raise EnrichmentValidationError(
                f"Turn {turn['id']} exceeds the enrichment input-token budget"
            )

    owner_ranges: list[tuple[int, int]] = []
    start = 0
    while start < len(turns):
        end = start
        owned_tokens = 0
        while end < len(turns):
            row_limit = end - start + 1 > options.max_output_rows
            token_limit = owned_tokens + token_costs[end] > options.max_input_tokens
            if row_limit or token_limit:
                break
            owned_tokens += token_costs[end]
            end += 1
        if end == start:
            raise EnrichmentValidationError(
                f"Cannot plan an owner window for turn {turns[start]['id']}"
            )
        owner_ranges.append((start, end))
        start = end

    windows: list[dict[str, Any]] = []
    for local_index, (owner_start, owner_end) in enumerate(owner_ranges):
        context_start = max(0, owner_start - options.overlap_turns)
        context_end = min(len(turns), owner_end + options.overlap_turns)
        selected_indices = list(range(owner_start, owner_end))
        input_tokens = sum(token_costs[index] for index in selected_indices)
        included_context: set[int] = set()
        for index in range(owner_start - 1, context_start - 1, -1):
            if input_tokens + token_costs[index] <= options.max_input_tokens:
                included_context.add(index)
                input_tokens += token_costs[index]
            else:
                break
        for index in range(owner_end, context_end):
            if input_tokens + token_costs[index] <= options.max_input_tokens:
                included_context.add(index)
                input_tokens += token_costs[index]
            else:
                break
        all_indices = sorted([*selected_indices, *included_context])
        owner_ids = [str(turns[index]["id"]) for index in selected_indices]
        context_ids = [
            str(turns[index]["id"]) for index in all_indices if index in included_context
        ]
        windows.append(
            {
                "id": f"enrichment-window-{window_offset + local_index + 1}",
                "chapterId": str(turns[owner_start].get("chapterId", "book")),
                "sceneId": turns[owner_start].get("sceneId"),
                "ownerTurnIds": owner_ids,
                "contextTurnIds": context_ids,
                "inputTurnIds": [str(turns[index]["id"]) for index in all_indices],
                "estimatedInputTokens": input_tokens,
                "maxOutputRows": options.max_output_rows,
            }
        )
    return windows


def _validate_plan_ownership(turns: list[dict[str, Any]], plan: dict[str, Any]) -> None:
    windows = plan.get("windows")
    if not isinstance(windows, list):
        raise EnrichmentValidationError("Enrichment plan has no valid windows")
    owners: list[str] = []
    input_ids = {str(turn["id"]) for turn in turns}
    for window in windows:
        if not isinstance(window, dict):
            raise EnrichmentValidationError("Enrichment window is not an object")
        window_owners = window.get("ownerTurnIds")
        context_ids = window.get("contextTurnIds")
        if not isinstance(window_owners, list) or not isinstance(context_ids, list):
            raise EnrichmentValidationError("Enrichment window has invalid turn IDs")
        if set(window_owners) & set(context_ids):
            raise EnrichmentValidationError("Owning turns cannot also be overlap context")
        if not set(window_owners).issubset(input_ids) or not set(context_ids).issubset(input_ids):
            raise EnrichmentValidationError("Enrichment plan contains an invented turn ID")
        owners.extend(str(turn_id) for turn_id in window_owners)
    if owners != [str(turn["id"]) for turn in turns]:
        raise EnrichmentValidationError("Enrichment plan does not own every turn exactly once")


def _validate_state_rows(
    turns: list[dict[str, Any]], rows: list[Any], enabled: bool
) -> list[dict[str, str]]:
    if not enabled:
        if rows:
            raise EnrichmentValidationError("Turn states were returned while state is disabled")
        return []

    expected = {str(turn["id"]): turn for turn in turns}
    validated: dict[str, dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise EnrichmentValidationError("Turn state row is not an object")
        turn_id = str(row.get("turnId", ""))
        if turn_id not in expected:
            raise EnrichmentValidationError(f"Invented enrichment turn id: {turn_id}")
        if turn_id in validated:
            raise EnrichmentValidationError(f"Duplicate enrichment turn id: {turn_id}")
        state = str(row.get("state", ""))
        if state not in STATE_VALUES:
            raise EnrichmentValidationError(f"Invalid state for turn {turn_id}: {state}")
        _validate_locked_fields(expected[turn_id], row)
        validated[turn_id] = {"turnId": turn_id, "state": state}

    missing = [turn_id for turn_id in expected if turn_id not in validated]
    if missing:
        raise EnrichmentValidationError(f"Missing enrichment turn ids: {', '.join(missing)}")
    return [validated[str(turn["id"])] for turn in turns]


def _validate_locked_fields(source: dict[str, Any], proposed: dict[str, Any]) -> None:
    for field in LOCKED_TURN_FIELDS:
        if field in proposed and proposed[field] != source.get(field):
            raise EnrichmentValidationError(
                f"Enrichment cannot change locked {field} for turn {source['id']}"
            )


def _validate_range_rows(
    turns: list[dict[str, Any]],
    rows: list[Any],
    *,
    ambience: bool,
    effects: bool,
) -> list[dict[str, str]]:
    order = {str(turn["id"]): index for index, turn in enumerate(turns)}
    chapters = {str(turn["id"]): str(turn.get("chapterId", "book")) for turn in turns}
    validated: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise EnrichmentValidationError("Range decorator is not an object")
        kind = str(row.get("kind", ""))
        if kind not in RANGE_DECORATOR_KINDS:
            raise EnrichmentValidationError(f"Invalid range decorator kind: {kind}")
        if kind == RangeDecoratorKind.AMBIENCE and not ambience:
            raise EnrichmentValidationError("Ambience was returned while ambience is disabled")
        if kind == RangeDecoratorKind.EFFECT and not effects:
            raise EnrichmentValidationError("Effect was returned while effects are disabled")
        start_id = str(row.get("startTurnId", ""))
        end_id = str(row.get("endTurnId", ""))
        if start_id not in order or end_id not in order:
            raise EnrichmentValidationError("Range decorator contains an invented turn ID")
        if order[start_id] > order[end_id]:
            raise EnrichmentValidationError("Range decorator start follows its end")
        if chapters[start_id] != chapters[end_id]:
            raise EnrichmentValidationError("Range decorator cannot cross chapter boundaries")
        value = str(row.get("value", "")).strip()
        if not value:
            raise EnrichmentValidationError("Range decorator has no value")
        key = (kind, start_id, end_id, value)
        if key in seen:
            raise EnrichmentValidationError("Duplicate range decorator")
        seen.add(key)
        validated.append(
            {"kind": kind, "startTurnId": start_id, "endTurnId": end_id, "value": value}
        )
    return validated


def _skip_plan(turns: list[dict[str, Any]], options: EnrichmentOptions) -> dict[str, Any]:
    return {
        "status": "skipped",
        "options": _options_dict(options),
        "windows": [],
        "workload": {
            "totalTurns": len(turns),
            "contextualWindows": 0,
            "estimatedInputTokens": 0,
            "expectedTurnRows": 0,
            "estimatedSeconds": 0,
            "estimatedDuration": "no model work",
            "modelLoad": "none",
        },
        "downstream": _downstream_honesty(),
    }


def _options_dict(options: EnrichmentOptions) -> dict[str, Any]:
    return {
        "state": options.state,
        "ambience": options.ambience,
        "effects": options.effects,
        "maxInputTokens": options.max_input_tokens,
        "maxOutputRows": options.max_output_rows,
        "overlapTurns": options.overlap_turns,
    }


def _duration_range(seconds: int) -> str:
    if seconds <= 0:
        return "less than a minute"
    low = max(1, math.ceil(seconds * 0.8 / 60))
    high = max(low, math.ceil(seconds * 1.2 / 60))
    return f"{low}-{high} minutes"


def _model_load(tokens: int) -> str:
    if tokens == 0:
        return "none"
    if tokens < 20_000:
        return "light"
    if tokens < 100_000:
        return "moderate"
    return "heavy"


def _downstream_honesty() -> dict[str, Any]:
    return {
        "affectsSynthesizedSpeech": False,
        "audibleAmbienceImplemented": False,
        "summary": "Presentation metadata only; current chapter audio is unchanged.",
    }
