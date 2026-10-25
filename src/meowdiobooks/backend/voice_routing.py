"""Source-based voice requirements shared by Cast and audio planning."""

from collections.abc import Mapping
from typing import Any


def is_narration_delimiter(span: Mapping[str, Any]) -> bool:
    """Nonverbal gaps between dialogue turns retain evidence but need no voice."""
    text = str(span.get("text", span.get("source", "")))
    return (
        str(span.get("renderRole", "narration")) != "dialogue"
        and bool(text)
        and not any(character.isalnum() for character in text)
    )


def speaker_labels(span: Mapping[str, Any]) -> list[str]:
    labels = span.get("speakerLabels")
    if labels is None:
        label = span.get("resolvedSpeakerLabel") or span.get("sourceSpeakerLabel")
        labels = [label] if label is not None else []
    return [str(value) for value in labels if str(value)]


def narrator_route(
    span: Mapping[str, Any], label_mapping: Mapping[str, Any]
) -> tuple[bool, str | None]:
    """Resolve narrator routing identically for cast planning and rendering."""
    if str(span.get("renderRole", "narration")) != "dialogue":
        return True, None
    if str(span.get("speakerStatus", "")).casefold() in {"unresolved", "open-marker"}:
        return True, "unresolved-speaker"
    labels = speaker_labels(span)
    if not labels:
        return True, "missing-speaker-label"
    for label in labels:
        if label not in label_mapping:
            return True, f"unmapped-label:{label}"
        if label_mapping[label] is None:
            return True, None
    return False, None


