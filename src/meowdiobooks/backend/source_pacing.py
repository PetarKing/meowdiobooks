"""Locate paragraph and confirmed-heading boundaries in accepted source ranges."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from difflib import SequenceMatcher
from typing import Any

from .chapters import detect_chapter_candidates, is_chapter_heading_hint

# A blank run is one separator regardless of its length. Single PDF wraps are not.
_PARAGRAPH = re.compile(r"\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*")


def source_boundaries(
    spans: Sequence[Mapping[str, Any]], script: Mapping[str, Any],
) -> dict[str, list[tuple[int, str]]]:
    """Return span-relative source cuts; attribution fragments share their block.

    Dialogue blocks are the accepted source's paragraph anchors. A page transition
    alone is not a paragraph: a separator in the source must establish that break.
    Confirmed Review chapter anchors establish headings; legacy opening title runs
    can supply a conservative source-layout fallback for timing only.
    """
    by_block: dict[str, list[Mapping[str, Any]]] = {}
    for span in spans:
        by_block.setdefault(str(span.get("blockId", "")), []).append(span)
    for rows in by_block.values():
        cursor = 0
        for row in sorted(rows, key=lambda row: int(row.get("sourceStart", 0))):
            source = str(row.get("source", ""))
            if int(row.get("sourceStart", 0)) != cursor:
                raise ValueError("Source pacing requires contiguous accepted source ranges")
            cursor += len(source)
            if int(row.get("sourceEnd", 0)) != cursor:
                raise ValueError("Source pacing source length disagrees with its range")
    blocks = {
        key: "".join(str(row.get("source", "")) for row in sorted(
            rows, key=lambda row: int(row.get("sourceStart", 0)),
        ))
        for key, rows in by_block.items()
    }
    headings: dict[str, list[tuple[int, int]]] = {}
    for chapter in script.get("chapters", []):
        boundary_id = str(chapter.get("boundaryId") or "")
        if not boundary_id.startswith("boundary:"):
            continue
        block_id, _, source_range = boundary_id[len("boundary:"):].rpartition(":")
        start_text, _, end_text = source_range.partition("-")
        if start_text.isdigit() and end_text.isdigit() and block_id in blocks:
            start, end = int(start_text), int(end_text)
            title = str(chapter.get("title", ""))
            if title and blocks[block_id][start:end] == title:
                headings.setdefault(block_id, []).append((start, end))
    # Older accepted Reviews can predate chapter anchors. For timing only, admit
    # a strict opening run of standalone uppercase/labelled title candidates.
    # Body directions, dialogue and later short prose never enter this fallback.
    opening_titles: set[str] = set()
    chapter_open: dict[str, bool] = {}
    candidates = {row["blockId"]: row for row in detect_chapter_candidates([
        {"id": key, "text": text, "page": by_block[key][0].get("page", 0)}
        for key, text in blocks.items()
    ])}
    for block_id, rows in by_block.items():
        chapter_id = str(rows[0].get("chapterId") or "chapter-1")
        if not chapter_open.get(chapter_id, True):
            continue
        text = blocks[block_id].strip()
        candidate = candidates.get(block_id)
        eligible = (
            candidate is not None and candidate["source"] == text
            and len(text.split()) <= 12 and len(text) <= 80
            and all(row.get("renderRole", "narration") == "narration" for row in rows)
            and (is_chapter_heading_hint(text) or (
                any(character.isupper() for character in text) and text == text.upper()
            ))
        )
        if eligible:
            opening_titles.add(block_id)
        elif text:
            chapter_open[chapter_id] = False
    result: dict[str, list[tuple[int, str]]] = {str(row["id"]): [] for row in spans}
    pending: str | None = None
    block_order = list(by_block)
    for block_number, (block_id, rows) in enumerate(by_block.items()):
        source = blocks[block_id]
        cuts: dict[int, str] = {}
        if pending:
            cuts[0] = pending
            pending = None
        block_headings = sorted(headings.get(block_id, []))
        finished_headings: set[tuple[int, int]] = set()
        if block_id in opening_titles:
            following = block_order[block_number + 1] if block_number + 1 < len(block_order) else None
            pending = None if following in opening_titles else "chapter-heading"
            # No paragraph gap within the opening title run itself.
            cuts.pop(0, None)
        else:
            cuts.update({offset: "paragraph" for offset in _indented_paragraph_starts(source)})
        for match in _PARAGRAPH.finditer(source):
            if block_id in opening_titles or not source[:match.start()].strip():
                continue
            kind = "paragraph"
            preceding = [heading for heading in block_headings
                         if heading not in finished_headings and match.start() >= heading[1]]
            if preceding:
                kind = "chapter-heading"
                finished_headings.update(preceding)
            cuts[match.end()] = kind
        for heading in block_headings:
            if heading in finished_headings or block_id in opening_titles:
                continue
            # If a confirmed title and body share one paragraph block, an exact
            # newline after the title can establish its end. A title-only block
            # carries its heading boundary to the next spoken source block.
            remainder = source[heading[1]:]
            newline = re.match(r"[ \t]*\r?\n[ \t]*", remainder)
            if newline and remainder[newline.end():].strip():
                cuts[heading[1] + newline.end()] = "chapter-heading"
            else:
                pending = "chapter-heading"
        # A page/block transition alone never creates a pause. Only a source
        # separator or confirmed heading can distinguish it from a PDF wrap.
        if len(source) in cuts:
            pending = cuts.pop(len(source))
        for offset, kind in sorted(cuts.items()):
            for row in sorted(rows, key=lambda row: int(row.get("sourceStart", 0))):
                start = int(row.get("sourceStart", 0))
                end = int(row.get("sourceEnd", 0))
                if start <= offset < end or offset == end == len(source):
                    result[str(row["id"])].append((offset - start, kind))
                    break
    return result


def _indented_paragraph_starts(source: str) -> list[int]:
    """Recognize sentence-complete paragraph indents, never consistent line wraps."""
    lines = list(re.finditer(r"[^\r\n]+", source))
    visible = [line for line in lines if line.group().strip()]
    if not visible:
        return []
    baseline = min(len(line.group()) - len(line.group().lstrip(" \t")) for line in visible)
    result = []
    for previous, current in zip(visible, visible[1:]):
        raw = current.group()
        indent = len(raw) - len(raw.lstrip(" \t"))
        separator = source[previous.end():current.start()]
        if (indent > baseline and separator in {"\n", "\r\n"}
                and re.search(r"[.!?。！？][\"'”’»）】」』]*$", previous.group().rstrip())):
            result.append(current.start() + indent)
    return result


def entry_parts(
    entry: Mapping[str, Any], spans: Sequence[Mapping[str, Any]],
    boundaries: Mapping[str, list[tuple[int, str]]],
) -> list[tuple[str, str | None]]:
    """Map source cuts into accepted speech while retaining every text character.

    Equal ranges map directly. Review may have repaired words on either side;
    matching unchanged separators still locates their boundary. An edit that
    removes the separator cannot establish a new boundary by guesswork.
    """
    original = ""
    source_cuts: list[tuple[int, str]] = []
    for span in spans:
        source = str(span.get("source", ""))
        start = int(span.get("sourceStart", 0))
        left = int(span.get("spokenStart", start)) - start
        right = int(span.get("spokenEnd", start + len(source))) - start
        for offset, kind in boundaries.get(str(span["id"]), []):
            if offset <= left:
                source_cuts.append((len(original), kind))
            elif offset <= right:
                source_cuts.append((len(original) + offset - left, kind))
        original += source[left:right]
    text = str(entry.get("text", ""))
    cuts: dict[int, str] = {}
    opcodes = SequenceMatcher(None, original, text, autojunk=False).get_opcodes()
    for offset, kind in source_cuts:
        mapped = None
        if offset == 0:
            mapped = 0
        elif offset == len(original):
            mapped = len(text)
        else:
            for tag, left, right, target_left, _target_right in opcodes:
                if tag == "equal" and left <= offset <= right:
                    mapped = target_left + offset - left
                    break
        if mapped is not None:
            if cuts.get(mapped) != "chapter-heading":
                cuts[mapped] = kind
    positions = sorted({0, len(text), *cuts})
    parts = [(text[left:right], cuts.get(left)) for left, right in zip(positions, positions[1:])]
    if len(text) in cuts:
        parts.append(("", cuts[len(text)]))
    return parts
