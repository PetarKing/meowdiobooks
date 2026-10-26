"""Expose structural heading anchors before a Dialogue candidate is accepted."""
from __future__ import annotations

from .chapters import detect_chapter_candidates


def partition_chapter_headings(scan):
    """Split plain narration only, preserving every source character and quoted turn.

    This works on an unpublished scan, never an accepted Dialogue artifact. The marker
    prevents attribution from coalescing the new boundary; it does not declare a chapter.
    """
    by_block = {}
    blocks = scan.get("blocks", [])
    source_by_id = {block["id"]: str(block["text"]) for block in blocks}
    for candidate in detect_chapter_candidates(blocks):
        text = source_by_id[candidate["blockId"]]
        # Include indentation in the new span so a complete physical footer or
        # heading line is never divided between two narrator owners.
        line_start = text.rfind("\n", 0, candidate["sourceStart"]) + 1
        by_block.setdefault(candidate["blockId"], set()).add(line_start)
    partition = []
    for original in scan.get("partition", []):
        span = dict(original)
        start, end = span["sourceStart"], span["sourceEnd"]
        source = span.get("source", "")
        eligible = (
            span.get("renderRole") == "narration"
            and span.get("origin") == "source-partition"
            and span.get("text") == source and len(source) == end - start
            and span.get("spokenStart") == start and span.get("spokenEnd") == end
            and not span.get("sourceSpeakerLabel")
        )
        cuts = sorted(point for point in by_block.get(span["blockId"], ())
                      if eligible and start < point < end)
        if not cuts:
            partition.append(span)
            continue
        bounds = [start, *cuts, end]
        for left, right in zip(bounds, bounds[1:]):
            fragment = {**span, "id": f"{span['id']}:chapter:{left}-{right}",
                        "sourceStart": left, "sourceEnd": right,
                        "spokenStart": left, "spokenEnd": right,
                        "source": source[left - start:right - start],
                        "text": source[left - start:right - start]}
            if left in cuts:
                fragment["chapterBoundaryDraft"] = True
            partition.append(fragment)
    return {**scan, "partition": partition}
