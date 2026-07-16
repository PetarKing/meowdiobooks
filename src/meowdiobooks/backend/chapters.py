"""Deterministic, reviewable chapter-boundary contracts."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any


class ChapterContractError(ValueError):
    """Raised when reviewed boundaries cannot partition accepted Dialogue spans."""


_EXPLICIT_HEADING = re.compile(
    r"(?i)^(?:chapter|part|book|act)\s+(?:\d+|[ivxlcdm]+|[a-z][\w'-]{0,30})"
    r"(?:\s*[:.\-—]\s*.+)?$|^arc\s+\d+\s*,?\s*chapter\s+\d+"
    r"(?:\s*[:.\-—–]\s*.+)?$|^(?:prologue|epilogue|interlude|afterword|preface)$"
)


def detect_chapter_candidates(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Find high-signal headings while leaving every semantic decision to Review."""
    candidates: list[dict[str, Any]] = []
    page_text: dict[int, str] = {}
    for block in blocks:
        page = int(block.get("page", 0))
        page_text[page] = page_text.get(page, "") + str(block.get("text", ""))
    for block in blocks:
        text = str(block.get("text", ""))
        lines = list(re.finditer(r"[^\n]+", text))
        for line_index, match in enumerate(lines):
            source = match.group(0).strip()
            if not source or len(source) > 120 or not _EXPLICIT_HEADING.fullmatch(source):
                continue
            block_id = str(block.get("id", ""))
            if not block_id:
                raise ChapterContractError("Chapter candidates require stable block IDs")
            candidates.append(
                {
                    "id": f"boundary:{block_id}:{match.start()}-{match.end()}",
                    "kind": "chapter-boundary",
                    "blockId": block_id,
                    "page": int(block.get("page", 0)),
                    "sourceStart": match.start(),
                    "sourceEnd": match.end(),
                    "source": source,
                    "reason": "Explicit standalone chapter/part heading syntax.",
                    "confidence": "high",
                    "lineIndex": line_index,
                }
            )
    counts: dict[int, int] = {}
    for candidate in candidates:
        page = int(candidate["page"])
        counts[page] = counts.get(page, 0) + 1
    return [
        candidate
        for candidate in candidates
        if counts[int(candidate["page"])] < 3
        and not re.search(
            r"(?im)^\s*(?:table\s+of\s+)?contents\s*$", page_text[int(candidate["page"])]
        )
    ]


def compile_reviewed_chapters(
    spans: Sequence[Mapping[str, Any]],
    candidates: Sequence[Mapping[str, Any]],
    decisions: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Assign every accepted span to one reviewed chapter without rewriting it."""
    ordered_spans = [dict(row) for row in spans]
    span_ids = [str(row.get("id", "")) for row in ordered_spans]
    if (
        not ordered_spans
        or any(not value for value in span_ids)
        or len(set(span_ids)) != len(span_ids)
    ):
        raise ChapterContractError("Dialogue spans need unique non-empty IDs")
    candidate_index = {str(row.get("id", "")): dict(row) for row in candidates}
    if any(not key for key in candidate_index) or len(candidate_index) != len(candidates):
        raise ChapterContractError("Boundary candidate IDs must be unique and non-empty")
    resolved: dict[str, str] = {}
    for row in decisions:
        boundary_id = str(row.get("boundaryId", ""))
        if boundary_id not in candidate_index:
            raise ChapterContractError(f"Unknown chapter boundary: {boundary_id}")
        if boundary_id in resolved:
            raise ChapterContractError(f"Duplicate chapter-boundary decision: {boundary_id}")
        action = str(row.get("action", ""))
        if action not in {"chapter-start", "not-a-boundary"}:
            raise ChapterContractError(f"Unsupported chapter-boundary action: {action}")
        resolved[boundary_id] = action
    missing = sorted(set(candidate_index) - set(resolved))
    if missing:
        raise ChapterContractError(
            "Explicit chapter-boundary decisions are missing for: " + ", ".join(missing)
        )

    first_span_by_block: dict[str, int] = {}
    for index, span in enumerate(ordered_spans):
        first_span_by_block.setdefault(str(span.get("blockId", "")), index)
    starts: list[tuple[int, dict[str, Any]]] = []
    for boundary_id, action in resolved.items():
        if action != "chapter-start":
            continue
        candidate = candidate_index[boundary_id]
        position = first_span_by_block.get(str(candidate.get("blockId", "")))
        if position is None:
            raise ChapterContractError(f"Boundary {boundary_id} has no Dialogue span anchor")
        starts.append((position, candidate))
    starts.sort(key=lambda row: row[0])

    chapters: list[dict[str, Any]] = []
    if not starts:
        chapters.append(
            _chapter(
                "complete-document",
                "Complete document",
                ordered_spans,
                0,
                len(ordered_spans),
                number=1,
            )
        )
    else:
        if starts[0][0] > 0:
            chapters.append(
                _chapter(
                    "opening-matter",
                    "Opening matter",
                    ordered_spans,
                    0,
                    starts[0][0],
                    number=None,
                )
            )
        for number, (start, candidate) in enumerate(starts, 1):
            end = starts[number][0] if number < len(starts) else len(ordered_spans)
            chapters.append(
                _chapter(
                    f"chapter-{number}",
                    str(candidate["source"]),
                    ordered_spans,
                    start,
                    end,
                    number=number,
                    boundary_id=str(candidate["id"]),
                )
            )
    span_chapters = {
        span_id: str(chapter["id"]) for chapter in chapters for span_id in chapter["sourceSpanIds"]
    }
    if set(span_chapters) != set(span_ids):
        raise ChapterContractError("Reviewed chapters must own every Dialogue span exactly once")
    return {
        "chapters": chapters,
        "spanChapterIds": span_chapters,
        "boundaryDecisions": [
            {"boundaryId": key, "action": resolved[key]} for key in sorted(resolved)
        ],
    }


def _chapter(
    chapter_id: str,
    title: str,
    spans: Sequence[Mapping[str, Any]],
    start: int,
    end: int,
    *,
    number: int | None,
    boundary_id: str | None = None,
) -> dict[str, Any]:
    owned = spans[start:end]
    if not owned:
        raise ChapterContractError(f"Chapter {chapter_id} would be empty")
    return {
        "id": chapter_id,
        "number": number,
        "title": title,
        "boundaryId": boundary_id,
        "startPage": int(owned[0].get("page", 0)),
        "endPage": int(owned[-1].get("page", 0)),
        "sourceSpanIds": [str(row["id"]) for row in owned],
        "estimatedCharacters": sum(len(str(row.get("text", ""))) for row in owned),
    }
