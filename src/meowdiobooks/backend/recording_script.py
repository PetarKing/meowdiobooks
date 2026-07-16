"""Compile the immutable, source-linked script consumed by audio generation."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


class RecordingScriptContractError(ValueError):
    """Raised when accepted upstream work cannot produce a recording script."""


_CHARACTERS_PER_SECOND = 15
LONG_CHAPTER_SECONDS = 2 * 60 * 60
TARGET_SPLIT_SECONDS = 30 * 60


def build_recording_script(
    dialogue: Mapping[str, Any],
    review: Mapping[str, Any],
    cast: Mapping[str, Any],
    *,
    revision: str,
    enrichment: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the one faithful script used to slice chapter generation work."""

    dialogue_revision = _revision(dialogue, "Dialogue")
    review_revision = _revision(review, "Review")
    cast_revision = _revision(cast, "Cast")
    if str(review.get("dialogueRevision", dialogue_revision)) != dialogue_revision:
        raise RecordingScriptContractError(
            "Review does not reference the accepted Dialogue revision"
        )
    if review.get("canStartCast") is False or review.get("blockers"):
        raise RecordingScriptContractError("Review still has progression blockers")
    if str(cast.get("dialogueRevision", dialogue_revision)) != dialogue_revision:
        raise RecordingScriptContractError(
            "Cast does not reference the accepted Dialogue revision"
        )
    if str(cast.get("reviewRevision", review_revision)) != review_revision:
        raise RecordingScriptContractError("Cast does not reference the accepted Review revision")
    if enrichment and (
        str(enrichment.get("dialogueRevisionId", dialogue_revision)) != dialogue_revision
        or str(enrichment.get("castRevisionId", cast_revision)) != cast_revision
    ):
        raise RecordingScriptContractError(
            "Enrichment does not reference the accepted Dialogue and Cast"
        )

    spans = _spans(dialogue)
    entries: list[dict[str, Any]] = []
    retained: dict[str, bool] = {}
    for span in spans:
        span_id = str(span["id"])
        keep = span.get("reviewAction") != "exclude"
        retained[span_id] = keep
        entries.append(
            {
                "id": f"script:{span_id}",
                "kind": "source" if keep else "omission",
                "chapterId": str(span.get("chapterId") or "chapter-1"),
                "sourceSpanIds": [span_id],
                "text": str(span.get("text", span.get("source", ""))) if keep else "",
                "sourceText": str(span.get("source", "")),
                "provenance": (
                    f"review:{span.get('reviewOccurrenceId')}:exclude"
                    if not keep
                    else "accepted-source"
                ),
            }
        )

    input_revisions = {
        "dialogue": dialogue_revision,
        "review": review_revision,
        "cast": cast_revision,
        "enrichment": _revision(enrichment, "Enrichment") if enrichment else None,
    }
    summary = _summary(spans, retained, cast)
    return {
        "contract": "meowdiobooks.script.v2",
        "kind": "script",
        "revision": _required_text(revision, "Recording script revision"),
        "status": "ready",
        "inputRevisions": input_revisions,
        "entries": entries,
        "sourceCoverage": {
            "status": "exact",
            "sourceSpanIds": [str(span["id"]) for span in spans],
        },
        "chapters": _script_chapters(review, spans, summary),
        "summary": summary,
    }


def split_recording_script_chapter(
    script: Mapping[str, Any],
    dialogue: Mapping[str, Any],
    cast: Mapping[str, Any],
    *,
    chapter_id: str,
    revision: str,
    chapters: list[Mapping[str, Any]] | None = None,
    target_seconds: int = TARGET_SPLIT_SECONDS,
    minimum_seconds: int = LONG_CHAPTER_SECONDS,
) -> dict[str, Any]:
    """Replace one oversized script chapter with balanced, source-safe chapters."""

    if script.get("status") != "ready":
        raise RecordingScriptContractError("Prepare the final recording script before splitting")
    if target_seconds <= 0 or minimum_seconds <= 0:
        raise RecordingScriptContractError("Chapter split durations must be positive")
    chapter_id = _required_text(chapter_id, "Chapter ID")
    entries = [dict(row) for row in script.get("entries", [])]
    selected = [(index, row) for index, row in enumerate(entries) if row.get("chapterId") == chapter_id]
    if not selected:
        raise RecordingScriptContractError(f"Unknown recording-script chapter: {chapter_id}")

    summary_row = next(
        (
            row
            for row in script.get("summary", {}).get("chapters", [])
            if str(row.get("chapterId")) == chapter_id
        ),
        None,
    )
    estimated_seconds = int((summary_row or {}).get("estimatedSeconds", 0))
    if estimated_seconds < minimum_seconds:
        raise RecordingScriptContractError(
            f"Chapter must be at least {minimum_seconds // 3600} hours to split"
        )

    retained_entries = [row for _index, row in selected if _entry_characters(row) > 0]
    total_characters = sum(_entry_characters(row) for _index, row in selected)
    requested_parts = max(
        2,
        math.ceil(total_characters / (target_seconds * _CHARACTERS_PER_SECOND)),
    )
    part_count = min(requested_parts, len(retained_entries))
    if part_count < 2:
        raise RecordingScriptContractError(
            "This chapter does not contain enough safe text boundaries to split"
        )

    groups: list[list[tuple[int, dict[str, Any]]]] = []
    current: list[tuple[int, dict[str, Any]]] = []
    current_characters = 0
    remaining_characters = total_characters
    remaining_parts = part_count
    retained_remaining = len(retained_entries)
    for index, entry in selected:
        characters = _entry_characters(entry)
        current.append((index, entry))
        current_characters += characters
        if characters:
            retained_remaining -= 1
        target = remaining_characters / remaining_parts
        if (
            remaining_parts > 1
            and current_characters >= target
            and retained_remaining >= remaining_parts - 1
        ):
            groups.append(current)
            current = []
            remaining_characters -= current_characters
            current_characters = 0
            remaining_parts -= 1
    if current:
        groups.append(current)
    if len(groups) != part_count:
        raise RecordingScriptContractError("Could not create balanced chapter parts safely")

    spans = _spans(dialogue)
    span_index = {str(row["id"]): row for row in spans}
    base_chapters = [dict(row) for row in (script.get("chapters") or chapters or [])]
    original = next((row for row in base_chapters if str(row.get("id")) == chapter_id), None)
    if original and original.get("splitFrom"):
        raise RecordingScriptContractError("A generated chapter part cannot be split again")
    title = str((original or {}).get("title") or _display_title(chapter_id))
    part_rows: list[dict[str, Any]] = []
    for part_number, group in enumerate(groups, 1):
        part_id = f"{chapter_id}--part-{part_number:02d}"
        source_spans = [
            span_index[source_id]
            for _index, entry in group
            for source_id in map(str, entry.get("sourceSpanIds", []))
            if source_id in span_index
        ]
        pages = [int(row.get("page", 0)) for row in source_spans if int(row.get("page", 0))]
        characters = sum(_entry_characters(entry) for _index, entry in group)
        part_rows.append(
            {
                "id": part_id,
                "title": f"{title} · Part {part_number}",
                "startPage": min(pages) if pages else None,
                "endPage": max(pages) if pages else None,
                "estimatedCharacters": characters,
                "splitFrom": chapter_id,
                "partNumber": part_number,
                "partCount": part_count,
            }
        )
        for index, _entry in group:
            entries[index]["chapterId"] = part_id

    if original:
        chapter_rows = [
            *base_chapters[: base_chapters.index(original)],
            *part_rows,
            *base_chapters[base_chapters.index(original) + 1 :],
        ]
    else:
        chapter_rows = part_rows

    chapter_by_span: dict[str, str] = {}
    retained: dict[str, bool] = {}
    for entry in entries:
        for source_id in map(str, entry.get("sourceSpanIds", [])):
            if source_id in chapter_by_span:
                raise RecordingScriptContractError(
                    f"Recording script assigns source span more than once: {source_id}"
                )
            chapter_by_span[source_id] = str(entry.get("chapterId") or "chapter-1")
            retained[source_id] = entry.get("kind") != "omission"
    if set(chapter_by_span) != {str(row["id"]) for row in spans}:
        raise RecordingScriptContractError("Recording script must preserve every source span")
    partitioned_spans = [
        {**row, "chapterId": chapter_by_span[str(row["id"])]} for row in spans
    ]
    return {
        **dict(script),
        "revision": _required_text(revision, "Recording script revision"),
        "entries": entries,
        "chapters": chapter_rows,
        "summary": _summary(partitioned_spans, retained, cast),
    }


def recording_script_blockers(script: Mapping[str, Any]) -> list[str]:
    """Return deterministic reasons a cached script cannot be used."""

    blockers = []
    if script.get("status") != "ready":
        blockers.append("Prepare the final recording script")
    if script.get("sourceCoverage", {}).get("status") != "exact":
        blockers.append("Restore exact Dialogue source-span coverage")
    return blockers


def recording_script_matches(
    script: Mapping[str, Any],
    dialogue: Mapping[str, Any],
    review: Mapping[str, Any],
    cast: Mapping[str, Any],
    enrichment: Mapping[str, Any] | None,
) -> bool:
    """Return whether a cached script pins the currently accepted inputs."""

    expected = {
        "dialogue": str(dialogue.get("revision") or ""),
        "review": str(review.get("revision") or ""),
        "cast": str(cast.get("revision") or ""),
        "enrichment": str(enrichment.get("revision") or "") if enrichment else None,
    }
    return not recording_script_blockers(script) and script.get("inputRevisions") == expected


def _script_chapters(
    review: Mapping[str, Any],
    spans: list[dict[str, Any]],
    summary: Mapping[str, Any],
) -> list[dict[str, Any]]:
    accepted = {
        str(row.get("id")): dict(row)
        for row in review.get("chapters", [])
        if isinstance(row, Mapping) and row.get("id")
    }
    summary_rows = {
        str(row.get("chapterId")): row for row in summary.get("chapters", [])
    }
    ordered_ids: list[str] = []
    pages: dict[str, list[int]] = {}
    for span in spans:
        chapter_id = str(span.get("chapterId") or "chapter-1")
        if chapter_id not in ordered_ids:
            ordered_ids.append(chapter_id)
        page = int(span.get("page", 0))
        if page:
            pages.setdefault(chapter_id, []).append(page)
    return [
        {
            **accepted.get(chapter_id, {}),
            "id": chapter_id,
            "title": str(accepted.get(chapter_id, {}).get("title") or _display_title(chapter_id)),
            "startPage": accepted.get(chapter_id, {}).get("startPage")
            or (min(pages.get(chapter_id, [])) if pages.get(chapter_id) else None),
            "endPage": accepted.get(chapter_id, {}).get("endPage")
            or (max(pages.get(chapter_id, [])) if pages.get(chapter_id) else None),
            "estimatedCharacters": int(
                summary_rows.get(chapter_id, {}).get("retainedCharacters", 0)
            ),
        }
        for chapter_id in ordered_ids
    ]


def _entry_characters(entry: Mapping[str, Any]) -> int:
    return len(str(entry.get("text", ""))) if entry.get("kind") != "omission" else 0


def _display_title(chapter_id: str) -> str:
    words = chapter_id.replace("_", " ").replace("-", " ").split()
    return " ".join(word if word.isdigit() else word.capitalize() for word in words) or "Chapter"


def _summary(
    spans: list[dict[str, Any]], retained: Mapping[str, bool], cast: Mapping[str, Any]
) -> dict[str, Any]:
    chapters: dict[str, dict[str, Any]] = {}
    dialogue_spans = 0
    fallback_spans = 0
    total_characters = 0
    retained_characters = 0
    for span in spans:
        span_id = str(span["id"])
        chapter_id = str(span.get("chapterId") or "chapter-1")
        chapter = chapters.setdefault(
            chapter_id,
            {
                "chapterId": chapter_id,
                "totalCharacters": 0,
                "retainedCharacters": 0,
                "dialogueSpans": 0,
                "narratorFallbackSpans": 0,
            },
        )
        characters = len(str(span.get("text", span.get("source", ""))))
        total_characters += characters
        chapter["totalCharacters"] += characters
        if retained[span_id]:
            retained_characters += characters
            chapter["retainedCharacters"] += characters
        if str(span.get("renderRole")) == "dialogue":
            dialogue_spans += 1
            chapter["dialogueSpans"] += 1
            if retained[span_id] and _uses_narrator_fallback(span, cast):
                fallback_spans += 1
                chapter["narratorFallbackSpans"] += 1

    empty_chapter_ids: list[str] = []
    chapter_rows = []
    for chapter in chapters.values():
        chapter["estimatedSeconds"] = round(
            chapter["retainedCharacters"] / _CHARACTERS_PER_SECOND
        )
        chapter["empty"] = chapter["retainedCharacters"] == 0
        if chapter["empty"]:
            empty_chapter_ids.append(chapter["chapterId"])
        chapter_rows.append(chapter)
    return {
        "totalSpans": len(spans),
        "retainedSpans": sum(retained.values()),
        "omittedSpans": len(spans) - sum(retained.values()),
        "dialogueSpans": dialogue_spans,
        "narratorFallbackSpans": fallback_spans,
        "totalCharacters": total_characters,
        "retainedCharacters": retained_characters,
        "omittedCharacters": total_characters - retained_characters,
        "estimatedSeconds": round(retained_characters / _CHARACTERS_PER_SECOND),
        "emptyChapterIds": empty_chapter_ids,
        "chapters": chapter_rows,
        "estimationMethod": "15-render-characters-per-second",
    }


def _uses_narrator_fallback(span: Mapping[str, Any], cast: Mapping[str, Any]) -> bool:
    status = str(span.get("speakerStatus", "")).casefold()
    labels = span.get("speakerLabels")
    if labels is None:
        label = span.get("resolvedSpeakerLabel") or span.get("sourceSpeakerLabel")
        labels = [label] if label else []
    labels = [str(value) for value in labels if str(value)]
    mapping = {str(key): value for key, value in cast.get("labelToCharacterId", {}).items()}
    return status in {"unresolved", "open-marker"} or not labels or any(
        label not in mapping for label in labels
    )


def _spans(dialogue: Mapping[str, Any]) -> list[dict[str, Any]]:
    spans = [dict(row) for row in (dialogue.get("spans") or dialogue.get("partition") or [])]
    ids = [str(row.get("id", "")) for row in spans]
    if not spans or any(not value for value in ids) or len(ids) != len(set(ids)):
        raise RecordingScriptContractError(
            "Dialogue requires non-empty unique source span IDs"
        )
    return spans


def _revision(artifact: Mapping[str, Any] | None, label: str) -> str:
    return _required_text((artifact or {}).get("revision"), f"{label} revision")


def _required_text(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise RecordingScriptContractError(f"{label} is required")
    return text
