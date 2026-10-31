"""Complete, source-owned editorial candidates; structure never authorizes deletion."""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from collections.abc import Mapping
from typing import Any

from .script_cues import bracket_ranges
from .chapters import detect_chapter_candidates

MAX_UNIT_CHARACTERS = 2400
CONTEXT_CHARACTERS = 300
EDGE_PAGE_LIMIT = 3


def editorial_candidates(extraction: Mapping[str, Any], dialogue: Mapping[str, Any]) -> dict[str, Any]:
    """Select whole paragraphs near book edges or repeated verbatim throughout it.

    Units are never shortened to fit a budget or a reader interval. A block boundary may be a
    physical page break, so model confirmation must establish completeness using adjacent context.
    """
    blocks = list(extraction.get("blocks", []))
    spans = dialogue.get("spans", [])
    headings = detect_chapter_candidates(blocks)
    units = []
    protected_regions = []
    counts: Counter[str] = Counter()
    pages = sorted({int(block.get("page", 1)) for block in blocks})
    edge_pages = set(pages[:EDGE_PAGE_LIMIT] + pages[-EDGE_PAGE_LIMIT:])
    for index, block in enumerate(blocks):
        text, block_id = str(block["text"]), str(block["id"])
        brackets = bracket_ranges(text)
        paragraphs = list(re.finditer(r"[^\n]+(?:\n(?![ \t]*\n)[^\n]+)*", text))
        boundaries = [(match.start(), match.end(), "paragraph") for match in paragraphs]
        # Ornament-only rules delimit whole regions without knowing the language. Keep the
        # ornaments themselves: they can be authored scene separators. A lone rule is not enough.
        rules = [match for match in re.finditer(r"[^\n]+", text)
                 if len("".join(match.group().split())) >= 3
                 and not any(char.isalnum() for char in match.group())]
        if len(rules) >= 2:
            regions = [(a.end(), b.start()) for a, b in zip(rules, rules[1:])]
            previous_lines = str(blocks[index - 1]["text"]).rstrip().splitlines() if index else []
            previous_rule = previous_lines[-1] if previous_lines else ""
            if index == 0 or (len("".join(previous_rule.split())) >= 3
                              and not any(char.isalnum() for char in previous_rule)):
                regions.insert(0, (0, rules[0].start()))
            else:
                counts["unboundedPagePrefixUnits"] += 1
            boundaries.extend((left, right, "ornament-bounded-unit") for left, right in regions)
        # A complete multiparagraph narrator region at a book edge can hold an entire notice.
        # Only existing paragraph boundaries qualify; never crop a paragraph to a reader split.
        for span in spans:
            if str(span.get("blockId")) != block_id or span.get("renderRole") != "narration":
                continue
            start, end = span.get("spokenStart", span.get("sourceStart")), span.get("spokenEnd", span.get("sourceEnd"))
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
                continue
            contained = [m for m in paragraphs if start <= m.start() + len(m.group()) - len(m.group().lstrip())
                         and m.end() - len(m.group()) + len(m.group().rstrip()) <= end]
            if len(contained) >= 3:
                first, last = contained[0], contained[-1]
                left = first.start() + len(first.group()) - len(first.group().lstrip())
                right = last.end() - len(last.group()) + len(last.group().rstrip())
                if not text[start:left].strip() and not text[right:end].strip():
                    boundaries.append((left, right, "multiparagraph-narrator-unit"))
        for raw_left, raw_right, basis in boundaries:
            raw = text[raw_left:raw_right]
            left = raw_left + len(raw) - len(raw.lstrip())
            right = raw_right - len(raw) + len(raw.rstrip())
            source = text[left:right]
            if any(max(left, rule.start()) < min(right, rule.end()) for rule in rules):
                counts["ornamentSpanningUnits"] += 1
                continue
            if any(str(heading["blockId"]) == block_id
                   and max(left, heading["sourceStart"]) < min(right, heading["sourceEnd"])
                   for heading in headings):
                counts["headingProtectedUnits"] += 1
                if basis == "multiparagraph-narrator-unit":
                    protected_regions.append((block_id, left, right))
                continue
            if len(source) < 40:
                counts["shortUnits"] += 1
                continue
            if len(source) > MAX_UNIT_CHARACTERS:
                counts["oversizedUnits"] += 1
                continue
            owners = [span for span in spans if str(span.get("blockId")) == block_id
                      and all(type(value) is int for value in (span.get("sourceStart"), span.get("sourceEnd"),
                          span.get("spokenStart", span.get("sourceStart")), span.get("spokenEnd", span.get("sourceEnd"))))
                      and 0 <= span["sourceStart"] <= span.get("spokenStart", span["sourceStart"]) <= left
                      and right <= span.get("spokenEnd", span["sourceEnd"]) <= span["sourceEnd"] <= len(text)
                      and span.get("source") == text[span["sourceStart"]:span["sourceEnd"]]]
            if len(owners) != 1 or owners[0].get("renderRole") != "narration":
                counts["nonNarratorOrCrossOwnerUnits"] += 1
                continue
            if any(max(left, start) < min(right, end) for start, end in brackets):
                counts["bracketProtectedUnits"] += 1
                continue
            before = (str(blocks[index - 1]["text"])[-CONTEXT_CHARACTERS:] + "\n") if index else ""
            after = ("\n" + str(blocks[index + 1]["text"])[:CONTEXT_CHARACTERS]) if index + 1 < len(blocks) else ""
            units.append({"windowId": f"{block_id}:{left}-{right}", "blockId": block_id,
                          "sourceStart": left, "sourceEnd": right, "source": source,
                          "page": int(block.get("page", 1)),
                          "contextBefore": (before + text[:left])[-CONTEXT_CHARACTERS:],
                          "contextAfter": (text[right:] + after)[:CONTEXT_CHARACTERS],
                          "normalizedUnit": " ".join(source.split()), "unitBasis": basis})
    distinct_pages: dict[str, set[int]] = {}
    for row in units:
        distinct_pages.setdefault(row["normalizedUnit"], set()).add(row["page"])
    candidates = []
    for row in units:
        if any(row["blockId"] == block_id and max(row["sourceStart"], left) < min(row["sourceEnd"], right)
               for block_id, left, right in protected_regions):
            counts["headingEnvelopeProtectedUnits"] += 1
            continue
        repeat = len(distinct_pages.get(row["normalizedUnit"], set())) >= 3
        edge = row["page"] in edge_pages
        structural = row["unitBasis"] == "ornament-bounded-unit"
        if not (repeat or edge or structural):
            counts["interiorUnrepeatedUnits"] += 1
            continue
        family = "editorial:" + hashlib.sha256(row["normalizedUnit"].encode()).hexdigest()[:20]
        candidates.append({**row, "editorialFamilyId": family,
                           "candidateBasis": "exact-repeated-unit" if repeat else row["unitBasis"] if structural or row["unitBasis"] == "multiparagraph-narrator-unit" else "book-edge-unit"})
    # Prefer a whole structural region over overlapping smaller paragraphs. Never emit competing
    # fragment/whole proposals for the same source. Exact repeated regions still share one family.
    priority = {"multiparagraph-narrator-unit": 0, "ornament-bounded-unit": 1, "paragraph": 2}
    chosen = []
    for row in sorted(candidates, key=lambda row: (priority[row["unitBasis"]], -(row["sourceEnd"] - row["sourceStart"]))):
        if any(row["blockId"] == other["blockId"] and max(row["sourceStart"], other["sourceStart"]) < min(row["sourceEnd"], other["sourceEnd"])
               for other in chosen):
            counts["overlappingSmallerUnits"] += 1
        else:
            chosen.append(row)
    order = {str(block["id"]): index for index, block in enumerate(blocks)}
    candidates = sorted(chosen, key=lambda row: (order[row["blockId"]], row["sourceStart"]))
    return {"candidates": candidates, "summary": {**dict(counts), "selectedUnits": len(candidates),
            "unitCharacterLimit": MAX_UNIT_CHARACTERS, "edgePageCount": len(edge_pages)}}
