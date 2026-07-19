"""Shared conservative consensus and review evidence for Dialogue attribution."""

from __future__ import annotations

from collections.abc import Sequence
from difflib import SequenceMatcher
import re
from typing import Any

from .dialogue import DialogueContractError


def normalised_answer(value: str) -> str:
    """Normalize presentation differences without mapping character identities."""

    return " ".join(value.split()).casefold()


def validate_speaker_evidence(speaker: str, context: str, span_id: str) -> None:
    """Require every proposed proper name to appear literally in the supplied context."""

    if set(speaker) <= {"?"} or speaker == "/":
        return
    if normalised_answer(speaker) not in normalised_answer(context):
        raise DialogueContractError(
            f"Speaker {speaker!r} for {span_id} has no literal support in focused context"
        )


def supported_consensus(
    first: str,
    second: str,
    context: str,
    span_id: str,
) -> str:
    """Keep a Character when two supported checks name the same likely reader."""

    if first == second == "/":
        return "/"
    if first in {"?", "/"} or second in {"?", "/"}:
        return "?"
    selected = _collated_name(first, second)
    if selected is None:
        return "?"
    try:
        validate_speaker_evidence(first, context, span_id)
        validate_speaker_evidence(second, context, span_id)
    except DialogueContractError:
        return "?"
    return selected


def _collated_name(first: str, second: str) -> str | None:
    """Choose one answer when presentation, containment or strict fuzziness is sufficient."""

    left = normalised_answer(first)
    right = normalised_answer(second)
    if left == right:
        return first

    left_tokens = _name_tokens(left)
    right_tokens = _name_tokens(right)
    if not left_tokens or not right_tokens:
        return None

    left_set = set(left_tokens)
    right_set = set(right_tokens)
    smaller = left_set if len(left_set) <= len(right_set) else right_set
    if (
        (left_set < right_set or right_set < left_set)
        and max(map(len, smaller)) >= 5
    ):
        return max(
            (first, second),
            key=lambda value: (len(_name_tokens(normalised_answer(value))), len(value)),
        )

    left_compact = "".join(left_tokens)
    right_compact = "".join(right_tokens)
    if min(len(left_compact), len(right_compact)) < 5:
        return None
    if _edit_distance_at_most_one(left_compact, right_compact):
        return first
    if (
        min(len(left_compact), len(right_compact)) >= 8
        and SequenceMatcher(None, left_compact, right_compact).ratio() >= 0.9
    ):
        return first
    return None


def _name_tokens(value: str) -> list[str]:
    return re.findall(r"\w+", value, flags=re.UNICODE)


def _edit_distance_at_most_one(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right, strict=True)) <= 1
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    short_index = 0
    mismatches = 0
    for character in longer:
        if short_index < len(shorter) and shorter[short_index] == character:
            short_index += 1
        else:
            mismatches += 1
            if mismatches > 1:
                return False
    return True


def supported_review_suggestions(
    answers: Sequence[str | None],
    final: str,
    context: str,
    span_id: str,
) -> list[str]:
    """Preserve supported withheld names for review, never as automatic assignments."""

    if final != "?":
        return []
    suggestions: list[str] = []
    seen: set[str] = set()
    for answer in answers:
        if not answer or answer in {"?", "/"}:
            continue
        normalised = normalised_answer(answer)
        if normalised in seen:
            continue
        try:
            validate_speaker_evidence(answer, context, span_id)
        except DialogueContractError:
            continue
        seen.add(normalised)
        suggestions.append(answer)
    return suggestions


def attribution_check(
    span_id: str,
    first: str,
    second: str | None,
    final: str,
    context: str,
    *,
    outcome: str,
) -> dict[str, Any]:
    """Build the route-independent attribution check consumed by human review."""

    return {
        "spanId": span_id,
        "firstPass": first,
        "secondPass": second,
        "final": final,
        "outcome": outcome,
        "suggestedSpeakers": supported_review_suggestions(
            (first, second), final, context, span_id
        ),
    }


def attribution_summary(
    checks: Sequence[dict[str, Any]], verifier_calls: int
) -> dict[str, int]:
    """Return the shared result counters for either attribution route."""

    return {
        "aiVerifierCalls": verifier_calls,
        "aiConsensusAccepted": sum(row["outcome"] == "agreed" for row in checks),
        "aiConsensusWithheld": sum(row["outcome"] == "withheld" for row in checks),
        "aiSuggestedForReview": sum(bool(row["suggestedSpeakers"]) for row in checks),
    }
