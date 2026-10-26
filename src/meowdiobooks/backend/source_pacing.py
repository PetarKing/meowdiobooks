"""Locate paragraph and confirmed-heading boundaries in accepted source ranges."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from difflib import SequenceMatcher
from typing import Any

# A blank run is one separator regardless of its length. Single PDF wraps are not.
_PARAGRAPH = re.compile(r"\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*")


def source_boundaries(
    spans: Sequence[Mapping[str, Any]], script: Mapping[str, Any],
) -> dict[str, list[tuple[int, str]]]:
    """Return span-relative source cuts; attribution fragments share their block.

    Dialogue blocks are the accepted source's paragraph anchors. A page transition
    alone is not a paragraph: a separator in the source must establish that break.
    Chapter headings require a confirmed Review boundary carried by the script.
    """
    headings: dict[str, tuple[str, str]] = {}
    for chapter in script.get("chapters", []):
        boundary_id = str(chapter.get("boundaryId") or "")
        if boundary_id.startswith("boundary:"):
            block_id, _, source_range = boundary_id[len("boundary:"):].rpartition(":")
            start_text, _, _end_text = source_range.partition("-")
            if start_text.isdigit():
                for span in spans:
                    if (str(span.get("blockId", "")) == block_id
                            and int(span.get("sourceStart", 0)) <= int(start_text)
                            < int(span.get("sourceEnd", 0))):
                        headings[str(span["id"])] = (str(chapter.get("title", "")), boundary_id)
                        break
    result: dict[str, list[tuple[int, str]]] = {}
    previous: Mapping[str, Any] | None = None
    heading_block: str | None = None
    for span in spans:
        source = str(span.get("source", ""))
        block_id = str(span.get("blockId", ""))
        cuts: list[tuple[int, str]] = []
        heading = headings.get(str(span["id"]))
        if heading and source.lstrip().startswith(heading[0]):
            heading_block = block_id
        if previous is not None and block_id != str(previous.get("blockId", "")):
            previous_source = str(previous.get("source", ""))
            same_page = (
                span.get("page") is not None and previous.get("page") is not None
                and span["page"] == previous["page"]
            )
            separator = bool(_PARAGRAPH.search(previous_source))
            if heading_block == str(previous.get("blockId", "")):
                cuts.append((0, "chapter-heading"))
                heading_block = None
            elif same_page or separator:
                cuts.append((0, "paragraph"))
        for match in _PARAGRAPH.finditer(source):
            kind = "chapter-heading" if heading_block == block_id else "paragraph"
            cuts.append((match.end(), kind))
            if kind == "chapter-heading":
                heading_block = None
        # A confirmed title can share its source paragraph with following prose.
        # Its exact accepted title is the anchor; no title-shape regex guesses.
        if heading and not cuts and source.lstrip().startswith(heading[0]):
            end = len(source) - len(source.lstrip()) + len(heading[0])
            if source[end:].strip():
                newline = re.match(r"[ \t]*\r?\n[ \t]*", source[end:])
                if newline:
                    cuts.append((end + newline.end(), "chapter-heading"))
                    heading_block = None
        result[str(span["id"])] = cuts
        previous = span
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
