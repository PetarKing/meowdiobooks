"""Prepare page-scoped OCR recovery without publishing or guessing new speakers."""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from .chapter_partition import partition_chapter_headings
from .chapters import detect_chapter_candidates
from .dialogue import pages_to_dialogue_blocks, scan_dialogue, validate_dialogue_partition
from .errors import WorkflowInputError
from .review import build_review_workspace


def prepare_review_ocr(
    source: Path, cache_root: Path, extraction: dict, dialogue: dict, requested_pages: list[int],
    *, page_count: int, source_hash: str, extract_page, report,
) -> tuple[dict, dict, dict]:
    """Keep empty/unchanged pages, abort on technical errors, and preserve other readers."""
    if extraction.get("sourceHash") != source_hash:
        raise WorkflowInputError("The accepted extraction does not match this source. Extract the document again.")
    originals = extraction.get("pages")
    expected = list(range(1, page_count + 1))
    if (not expected or not isinstance(originals, list) or extraction.get("pageCount") != page_count
            or any(not isinstance(row, dict) or type(row.get("page")) is not int
                   or not isinstance(row.get("text"), str) for row in originals)
            or [row["page"] for row in originals] != expected):
        raise WorkflowInputError("The accepted extraction is missing source pages. Extract the document again.")
    if any(page < 1 or page > page_count for page in requested_pages):
        raise WorkflowInputError("An OCR page is outside this document.")
    if (dialogue.get("extractionRevision") != extraction.get("revision")
            or build_review_workspace(extraction, dialogue)["sourceReconstruction"]["status"] != "exact"):
        raise WorkflowInputError("Rebuild speaker assignments before recovering source pages.")
    validate_dialogue_partition(dialogue)
    outcome = {"requestedPages": sorted(requested_pages), "recoveredPages": [],
               "emptyPages": [], "unchangedPages": []}
    pages = deepcopy(originals)
    for index, number in enumerate(requested_pages, 1):
        report(2 + (index - 1) / len(requested_pages) * 45, f"Reading page {number} with OCR")
        recovered = extract_page(source, cache_root, number, "ocr")
        if (not isinstance(recovered, dict) or type(recovered.get("page")) is not int
                or recovered["page"] != number or not isinstance(recovered.get("text"), str)):
            raise WorkflowInputError("OCR returned an invalid page. Please try again.")
        text = recovered["text"]
        if not text.strip():
            outcome["emptyPages"].append(number)
        elif " ".join(text.split()) == " ".join(pages[number - 1]["text"].split()):
            outcome["unchangedPages"].append(number)
        else:
            outcome["recoveredPages"].append(number)
            pages[number - 1] = {**pages[number - 1], **recovered, "page": number,
                                 "text": text, "method": "ocr", "warnings": recovered.get("warnings", [])}
        report(2 + index / len(requested_pages) * 45, f"Checked OCR page {number}")
    for values in outcome.values():
        values.sort()
    if not outcome["recoveredPages"]:
        return extraction, dialogue, outcome
    blocks = pages_to_dialogue_blocks(pages)
    prior = extraction.get("ocrPages") or []
    updated = {
        **deepcopy(extraction), "revision": uuid4().hex, "pages": pages, "blocks": blocks,
        "publicationOwner": "review-ocr",
        "baseExtractionRevision": extraction["revision"],
        "ocrPages": sorted({page for page in prior if type(page) is int and 1 <= page <= page_count}
                           | set(outcome["recoveredPages"])),
        "recoveredPages": sorted(outcome["recoveredPages"]), "ocrRecovery": outcome,
        "boundaryCandidates": detect_chapter_candidates(blocks),
        "warnings": [{**warning, "page": page["page"]} for page in pages
                     for warning in page.get("warnings", []) if isinstance(warning, dict)],
    }
    rebased = _rebase_dialogue(extraction, dialogue, updated, set(outcome["recoveredPages"]))
    validate_dialogue_partition(rebased)
    check = build_review_workspace(updated, rebased)
    if check["sourceReconstruction"]["status"] != "exact" or check.get("recovery") is not None:
        raise WorkflowInputError("Could not preserve the transcript while recovering pages. Your accepted text is unchanged.")
    return updated, rebased, outcome


def _rebase_dialogue(original, dialogue, extraction, changed_pages):
    # New text starts as narration. Existing accepted speaker choices remain
    # byte-for-byte intact everywhere whose source has not changed.
    blocks = extraction["blocks"]
    changed_blocks = [row for row in blocks if row["page"] in changed_pages]
    fresh = partition_chapter_headings(scan_dialogue(changed_blocks, enabled_profile_ids=[]))
    by_block = defaultdict(list)
    original_blocks = {row["id"]: row for row in original["blocks"]}
    preserved_blocks = {row["id"] for row in blocks if row["page"] not in changed_pages}
    for block in blocks:
        if block["id"] in preserved_blocks and original_blocks.get(block["id"]) != block:
            raise WorkflowInputError("An unchanged source block moved during OCR recovery.")
    for span in dialogue.get("spans") or dialogue.get("partition") or []:
        if span.get("blockId") in preserved_blocks:
            by_block[span["blockId"]].append(deepcopy(span))
    for span in fresh["partition"]:
        by_block[span["blockId"]].append(span)
    spans = [span for block in blocks for span in by_block[block["id"]]]
    result = deepcopy(dialogue)
    # Reopening a corrected-from ancestor would resurrect the old Extraction.
    result.pop("correctedFromRevision", None)
    for field in ["matches", "acceptedMatches", "aiTargetSpans"]:
        result[field] = [row for row in result.get(field, []) if row.get("blockId") in preserved_blocks]
    # Source-range IDs can repeat when replacement text has the same length.
    # Only unchanged-source targets may retain old correction ownership.
    safe_ids = {str(row["id"]) for row in spans if row.get("blockId") in preserved_blocks}
    safe_ids.update(str(row["id"]) for row in result.get("aiTargetSpans", []))
    def safe_targets(row):
        targets = [str(value) for value in row.get("spanIds", [row.get("spanId", "")])]
        return bool(targets) and all(value in safe_ids for value in targets)
    result["userCorrections"] = [row for row in result.get("userCorrections", []) if safe_targets(row)]
    result["aiWindows"] = [row for row in result.get("aiWindows", [])
                           if row.get("dossiers") and all(safe_targets(dossier) for dossier in row["dossiers"])]
    result.update(
        revision=uuid4().hex, extractionRevision=extraction["revision"], blocks=deepcopy(blocks),
        publicationOwner="review-ocr",
        spans=spans, partition=spans, recoveredFromDialogueRevision=dialogue["revision"],
        ocrRecovery={"recoveredPages": sorted(changed_pages), "newTextPolicy": "narration"},
        conflicts=[], structuralIssues=[],
    )
    summary = dict(result.get("resultSummary") or {})
    summary.update(totalTurns=len(spans), aiAttributed=sum(row.get("speakerStatus") == "ai" for row in spans),
                   unresolved=sum(row.get("speakerStatus") in {"unresolved", "unlabelled"} for row in spans))
    result["resultSummary"] = summary
    return result
