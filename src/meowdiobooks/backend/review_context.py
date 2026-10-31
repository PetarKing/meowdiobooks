"""Bounded, sentence-aware source evidence for human review, never model input."""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

_TARGET = 180
_LIMIT = 600
# A display heuristic, not a language classifier. Include closing quotation marks.
_SENTENCE_END = re.compile(r'''(?:[.!?][”’"')\]]*(?:\s+|$)|[。！？][”’」』]*\s*)''')


def _before(text: str, clipped: bool) -> str:
    boundaries = [match.end() for match in _SENTENCE_END.finditer(text)
                  if match.end() <= len(text) - _TARGET]
    if boundaries:
        return text[boundaries[-1]:].lstrip()
    if clipped:
        # Never present a clipped word as though it were a complete word.
        boundary = re.search(r"\s+", text)
        if boundary:
            text = text[boundary.end():]
        return "… " + text.lstrip()
    return text.lstrip()


def _after(text: str, clipped: bool) -> str:
    boundary = next((match.end() for match in _SENTENCE_END.finditer(text)
                     if match.end() >= _TARGET), None)
    if boundary is not None:
        return text[:boundary].rstrip()
    if clipped:
        boundary = list(re.finditer(r"\s+", text))
        if boundary:
            text = text[:boundary[-1].start()]
        return text.rstrip() + " …"
    return text.rstrip()


def add_source_context(
    occurrences: Sequence[dict[str, Any]], blocks: Sequence[Mapping[str, Any]]
) -> None:
    """Add nearby sentences across block boundaries without changing anchored targets.

    Build one ordered source index per batch. Short labels/whitespace must not prevent
    adjacent prose from being shown. Ellipses disclose the cap for oversized sentences.
    Separators represent extraction block boundaries, not invented manuscript words.
    """
    parts, offsets = [], {}
    cursor = 0
    for block in blocks:
        text = str(block.get("text", ""))
        offsets[str(block["id"])] = (cursor, len(text))
        parts.append(text)
        cursor += len(text) + 2
    document = "\n\n".join(parts)
    for occurrence in occurrences:
        anchor = offsets.get(str(occurrence.get("blockId", "")))
        start, end = occurrence.get("sourceStart"), occurrence.get("sourceEnd")
        if (anchor is None or type(start) is not int or type(end) is not int
                or not 0 <= start <= end <= anchor[1]):
            continue
        start, end = anchor[0] + start, anchor[0] + end
        left, right = max(0, start - _LIMIT), min(len(document), end + _LIMIT)
        occurrence["contextLayout"] = "continuous"
        occurrence["contextBefore"] = _before(document[left:start], left > 0)
        occurrence["contextAfter"] = _after(document[end:right], right < len(document))
        # Empty-page targets have no adjacent characters whose spacing must be kept.
        if start == end:
            occurrence["contextBefore"] = occurrence["contextBefore"].rstrip()
            occurrence["contextAfter"] = occurrence["contextAfter"].lstrip()
