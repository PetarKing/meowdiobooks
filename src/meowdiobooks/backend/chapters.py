"""Deterministic, reviewable chapter-boundary contracts."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any


class ChapterContractError(ValueError):
    """Raised when reviewed boundaries cannot partition accepted Dialogue spans."""


# Hints improve recall; they never establish a chapter boundary without Review.
# Covers the ten text languages declared by the model registry. Unlisted languages
# still use the language-independent isolated-title path.
_HEADING_HINT = re.compile(
    r"(?ix)^(?:(?:chapter|part|book|act|arc|chapitre|partie|livre|acte|"
    r"kapitel|teil|buch|akt|capitolo|parte|libro|atto|capítulo|capitulo|"
    r"livro|ato|acto|глава|часть|книга|акт)\s+\S+"
    r"|(?:prologue|epilogue|interlude|afterword|preface|préface|prolog|epilog|"
    r"vorwort|nachwort|prologo|epilogo|prefazione|prólogo|epílogo|prefácio|"
    r"prefacio|пролог|эпилог|предисловие)(?:\s*[:：—–-].*)?"
    r"|第\s*[0-9０-９一二三四五六七八九十百千零〇]+\s*[章回部幕篇].*"
    r"|(?:序章|終章|终章|序言|後記|后记|あとがき|まえがき|プロローグ|エピローグ).*"
    r"|제?\s*[0-9０-９일이삼사오육칠팔구십]+\s*[장부막].*"
    r"|(?:서문|후기|프롤로그|에필로그).*)$"
)


def is_chapter_heading_hint(source: str) -> bool:
    """A multilingual recall hint, never a semantic boundary/deletion verdict."""
    source = source.strip()
    if not source or len(source) > 120:
        return False
    # Prefix-labelled headings may contain arbitrary titles after their identifier.
    return bool(_HEADING_HINT.match(source) or re.fullmatch(
        r"(?i)\S+\s+(?:act|acte|akt|atto|ato|acto|幕|막)", source
    ) or re.match(
        r"(?i)^(?:chapter|part|book|act|arc|chapitre|partie|livre|acte|kapitel|teil|"
        r"buch|akt|capitolo|parte|libro|atto|capítulo|capitulo|livro|ato|acto|"
        r"глава|часть|книга|акт)\s+\S+", source
    ))


def detect_chapter_candidates(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Draft standalone headings using layout; semantic confirmation happens in Review.

    Paragraph-internal prose lines are ineligible. Repeated identical page headings
    are conservative running-header exclusions, never text deletions. TOCs are
    assessed locally by Review rather than suppressing an entire page or chunk.
    """
    candidates: list[dict[str, Any]] = []
    for block in blocks:
        text = str(block.get("text", ""))
        for match in re.finditer(r"[^\n]+", text):
            raw = match.group()
            source = raw.strip()
            start = match.start() + len(raw) - len(raw.lstrip())
            end = start + len(source)
            if not source or len(source) > 120 or not any(char.isalnum() for char in source):
                continue
            prefix = text[:start]
            block_start = not prefix.strip()
            blank_before = bool(re.search(r"\n[ \t]*\n[ \t]*$", prefix))
            if not block_start and not blank_before:
                continue
            remainder = text[end:]
            hint = is_chapter_heading_hint(source)
            isolated = not remainder.strip() or bool(re.match(r"[ \t]*\n[ \t]*\n", remainder))
            short_title = len(source.split()) <= 12 and not re.search(r'[.!?。！？;；,，"”»]$', source)
            next_lines = [line for line in remainder.splitlines() if line.strip()][:3]
            indentation = len(raw) - len(raw.lstrip())
            indented_title = block_start and indentation >= 4 and any(
                len(line) - len(line.lstrip()) < indentation for line in next_lines
            )
            if not hint and not (short_title and (isolated or indented_title)):
                continue
            # A separate subtitle immediately after an explicit heading belongs to
            # that heading, not a second chapter. No prose may intervene.
            if not hint and candidates:
                previous = candidates[-1]
                if (previous["blockId"] == str(block.get("id", ""))
                        and previous["structuralEvidence"]["headingHint"]
                        and not text[previous["sourceEnd"]:start].strip()):
                    continue
            block_id = str(block.get("id", ""))
            if not block_id:
                raise ChapterContractError("Chapter candidates require stable block IDs")
            candidates.append({
                "id": f"boundary:{block_id}:{start}-{end}",
                "kind": "chapter-boundary", "blockId": block_id,
                "page": int(block.get("page", 0)), "sourceStart": start,
                "sourceEnd": end, "source": source,
                "reason": "Standalone heading layout; requires semantic and reader confirmation.",
                "confidence": "uncertain", "lineIndex": text[:start].count("\n"),
                "structuralEvidence": {"blockStart": block_start, "isolated": isolated,
                                       "headingHint": hint},
            })
    # Extraction commonly puts heading and subtitle in separate adjacent blocks.
    block_positions = {str(block.get("id", "")): index for index, block in enumerate(blocks)}
    combined = []
    for row in candidates:
        previous = combined[-1] if combined else None
        if previous and not row["structuralEvidence"]["headingHint"] and previous["structuralEvidence"]["headingHint"]:
            left, right = block_positions[previous["blockId"]], block_positions[row["blockId"]]
            if (right == left + 1 and previous["page"] == row["page"]
                    and not str(blocks[left]["text"])[previous["sourceEnd"]:].strip()
                    and not str(blocks[right]["text"])[:row["sourceStart"]].strip()):
                continue
        combined.append(row)
    candidates = combined
    repeated_pages: dict[str, set[int]] = {}
    for row in candidates:
        repeated_pages.setdefault(row["source"].casefold(), set()).add(row["page"])
    return [row for row in candidates
            if len(repeated_pages[row["source"].casefold()]) < 3]


def validate_chapter_candidates(
    blocks: Sequence[Mapping[str, Any]], candidates: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Admit only exact eligible source anchors, never model-invented headings."""
    eligible = {row["id"]: row for row in detect_chapter_candidates(blocks)}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for supplied in candidates:
        candidate_id = supplied.get("id")
        original = eligible.get(candidate_id)
        if original is None or candidate_id in seen or any(
            supplied.get(key) != original[key]
            for key in ("blockId", "page", "sourceStart", "sourceEnd", "source")
        ):
            raise ChapterContractError("Chapter boundary is not an exact eligible source anchor")
        seen.add(candidate_id)
        result.append(dict(original))
    return result


def chapter_span_position(candidate, spans):
    """Return an existing exact span boundary; never move a heading backwards into prose."""
    for position, span in enumerate(spans):
        if span.get("blockId") != candidate["blockId"]:
            continue
        start = span.get("sourceStart", 0)
        source = str(span.get("source", span.get("text", "")))
        delta = candidate["sourceStart"] - start
        if 0 <= delta <= len(source) and not source[:delta].strip() and source[delta:].startswith(candidate["source"]):
            return position
    return None


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

    starts: list[tuple[int, dict[str, Any]]] = []
    for boundary_id, action in resolved.items():
        if action != "chapter-start":
            continue
        candidate = candidate_index[boundary_id]
        position = chapter_span_position(candidate, ordered_spans)
        if position is None:
            raise ChapterContractError(f"Boundary {boundary_id} has no exact Dialogue span boundary")
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
