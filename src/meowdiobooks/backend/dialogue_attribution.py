"""Shared conservative consensus and review evidence for Dialogue attribution."""

from __future__ import annotations

from collections.abc import Sequence
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


def exact_supported_consensus(
    first: str,
    second: str,
    context: str,
    span_id: str,
) -> str:
    """Keep a Character only when two checks agree and both have literal evidence."""

    if first == second == "/":
        return "/"
    if first in {"?", "/"} or second in {"?", "/"}:
        return "?"
    if normalised_answer(first) != normalised_answer(second):
        return "?"
    try:
        validate_speaker_evidence(first, context, span_id)
        validate_speaker_evidence(second, context, span_id)
    except DialogueContractError:
        return "?"
    return first


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
