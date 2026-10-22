"""Pure Review-phase contracts.

Review begins after an extraction and its lossless Dialogue transcript have been
accepted.  It detects source-quality warnings, preserves exact evidence, and records
explicit user policies.  It never reparses
dialogue or mutates accepted source text.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


class ReviewContractError(ValueError):
    """Raised when a Review revision would be ambiguous or lossy."""


WARNING_CONFIG: dict[str, dict[str, Any]] = {
    "stage-direction": {
        "severity": "warning",
        "actions": ("keep", "exclude", "narrate"),
    },
    "empty-page": {
        "severity": "blocking",
        "actions": ("keep", "rerun-extraction"),
    },
    "suspicious-extraction": {
        "severity": "warning",
        "actions": ("keep", "narrate", "exclude", "rerun-extraction"),
    },
    "reading-order": {
        "severity": "warning",
        "actions": ("keep", "rerun-extraction"),
    },
    "repeated-matter": {
        "severity": "warning",
        "actions": ("keep", "exclude"),
    },
    "page-number": {
        "severity": "warning",
        "actions": ("keep", "exclude"),
    },
    "web-address": {
        "severity": "warning",
        "actions": ("keep", "exclude"),
    },
    "footnote": {
        "severity": "warning",
        "actions": ("keep", "narrate", "exclude"),
    },
    "front-back-matter": {
        "severity": "warning",
        "actions": ("keep", "narrate", "exclude"),
    },
}

_UPSTREAM_ACTIONS = {"rerun-extraction", "rerun-dialogue"}
_INTERNAL_WARNING_CONFIG = {
    "malformed-coverage": {
        "severity": "blocking",
        "actions": ("rerun-dialogue", "rerun-extraction"),
    }
}
_PAGE_NUMBER = re.compile(r"^\s*(?:\d{1,4}|[ivxlcdm]{1,10})\s*$", re.IGNORECASE)
_WEB_ADDRESS = re.compile(r"\b(?:https?://|www\.)[^\s<>{}\[\]\"']+", re.IGNORECASE)
_WEB_ADDRESS_TRAILING_PUNCTUATION = ".,;:!?)]}"
_FOOTNOTE = re.compile(r"^\s*(?:\[?\d{1,3}\]?|[*†‡])(?:[.)\]]|\s{1,3})\s*\S")
_CHAPTER_LIST_ENTRY = re.compile(r"^\s*\d{1,3}[.)]\s+chapter\s+\d+\b", re.IGNORECASE)
_NOTE_SECTION_HEADER = re.compile(
    r"^\s*(?:(?:translator(?:'s)?|translation|tl)\s+notes?)\s*:?\s*$",
    re.IGNORECASE,
)
_NOTE_SECTION_BOUNDARY = re.compile(
    r"^\s*(?:(?:chapter|part|book)\s+\S+|prologue\b|epilogue\b|"
    r"(?:human|machine)\s+translated\s+by\b|proofread\s+by\b|"
    r"japanese\s+to\s+english\s+checking\s+by\b|art\s+sources?\b)",
    re.IGNORECASE,
)
_PERIPHERAL = re.compile(
    r"^\s*(?:copyright|contents|table of contents|translator(?:'s)? note|"
    r"translation note|acknowledgements?|about the author|index|bibliography)\b",
    re.IGNORECASE,
)


def build_review_workspace(
    extraction: Mapping[str, Any], dialogue: Mapping[str, Any]
) -> dict[str, Any]:
    """Detect source-quality warnings against two accepted upstream revisions."""

    extraction_revision = _required_revision(extraction, "Extraction")
    dialogue_revision = _required_revision(dialogue, "Dialogue")
    linked = dialogue.get("extractionRevision")
    if linked is not None and str(linked) != extraction_revision:
        raise ReviewContractError(
            "Dialogue revision does not reference the accepted Extraction revision"
        )

    blocks = _normalise_blocks(extraction)
    spans = list(dialogue.get("spans") or dialogue.get("partition") or [])
    occurrences: list[dict[str, Any]] = []
    coverage_failures = _coverage_occurrences(blocks, spans)
    occurrences.extend(_empty_occurrences(blocks))
    occurrences.extend(_text_occurrences(blocks))
    occurrences.extend(_stage_direction_occurrences(blocks, spans))
    occurrences.extend(_metadata_occurrences(extraction, blocks))
    occurrences = _deduplicate_occurrences(occurrences)
    _add_adjacent_context(occurrences, blocks)
    warnings = _group_occurrences(occurrences, spans)

    return {
        "contract": "meowdiobooks.review-workspace.v2",
        "extractionRevision": extraction_revision,
        "dialogueRevision": dialogue_revision,
        "sourceReconstruction": _source_reconstruction(blocks, spans),
        "recovery": (
            {
                "kind": "source-coverage",
                "severity": "blocking",
                "message": (
                    "Extraction completed, but Dialogue no longer partitions its source exactly. "
                    "Rebuild Dialogue first; try another extraction only if the source itself is wrong."
                ),
                "availableActions": ["rerun-dialogue", "rerun-extraction"],
                "occurrences": coverage_failures,
            }
            if coverage_failures
            else None
        ),
        "warnings": warnings,
        "summary": {
            "groups": len(warnings),
            "occurrences": sum(len(row["occurrences"]) for row in warnings),
            "blockingOccurrences": sum(
                row["severity"] == "blocking" for row in warnings for _ in row["occurrences"]
            ),
        },
    }


def preview_bulk_decision(
    workspace: Mapping[str, Any], occurrence_id: str, action: str
) -> dict[str, Any]:
    """Preview an identical-evidence bulk decision and issue a deterministic token."""

    occurrence_index = _occurrence_index(workspace)
    if occurrence_id not in occurrence_index:
        raise ReviewContractError(f"Unknown warning occurrence: {occurrence_id}")
    seed = occurrence_index[occurrence_id]
    _validate_action(seed, action)
    target_ids = sorted(
        row_id
        for row_id, row in occurrence_index.items()
        if row["kind"] == seed["kind"] and row["matchKey"] == seed["matchKey"]
    )
    consequence = _consequence(action, len(target_ids))
    token = _preview_token(workspace, target_ids, action)
    return {
        "warningId": seed["warningId"],
        "action": action,
        "targetOccurrenceIds": target_ids,
        "affectedCount": len(target_ids),
        "consequence": consequence,
        "previewToken": token,
    }


def accept_review_revision(
    workspace: Mapping[str, Any],
    decisions: Sequence[Mapping[str, Any]],
    *,
    revision: str,
) -> dict[str, Any]:
    """Compile an immutable/history-ready receipt from explicit Review decisions."""

    if not revision.strip():
        raise ReviewContractError("Review revision is required")
    occurrence_index = _occurrence_index(workspace)
    accepted: dict[str, dict[str, Any]] = {}
    for raw in decisions:
        target_ids = [str(value) for value in raw.get("occurrenceIds", [])]
        if not target_ids:
            raise ReviewContractError("Every decision requires occurrenceIds")
        if len(set(target_ids)) != len(target_ids):
            raise ReviewContractError("A decision cannot repeat an occurrence ID")
        unknown = sorted(set(target_ids) - set(occurrence_index))
        if unknown:
            raise ReviewContractError(f"Unknown warning occurrence IDs: {unknown}")
        action = str(raw.get("action", ""))
        if len(target_ids) > 1:
            bulk_keys = {
                (
                    occurrence_index[occurrence_id].get("kind"),
                    occurrence_index[occurrence_id].get("matchKey"),
                )
                for occurrence_id in target_ids
            }
            if len(bulk_keys) != 1:
                raise ReviewContractError(
                    "Bulk decisions may only target identical warning evidence"
                )
            supplied = str(raw.get("previewToken", ""))
            expected = _preview_token(workspace, sorted(target_ids), action)
            if supplied != expected:
                raise ReviewContractError("Bulk decisions require the matching consequence preview")
        for occurrence_id in target_ids:
            if occurrence_id in accepted:
                raise ReviewContractError(f"Duplicate decision for: {occurrence_id}")
            occurrence = occurrence_index[occurrence_id]
            _validate_action(occurrence, action)
            accepted[occurrence_id] = {
                "occurrenceId": occurrence_id,
                "warningId": occurrence["warningId"],
                "action": action,
                "consequence": _consequence(action, 1),
                "provenance": str(raw.get("provenance") or "user"),
            }

    missing = sorted(set(occurrence_index) - set(accepted))
    if missing:
        raise ReviewContractError(
            "No silent defaults: explicit decisions are missing for " + ", ".join(missing)
        )

    ordered = [accepted[key] for key in sorted(accepted)]
    blockers = _blockers(workspace, ordered, occurrence_index)
    return {
        "contract": "meowdiobooks.review.v2",
        "kind": "review",
        "revision": revision,
        "extractionRevision": str(workspace["extractionRevision"]),
        "dialogueRevision": str(workspace["dialogueRevision"]),
        "sourceReconstruction": dict(workspace["sourceReconstruction"]),
        "warningSnapshot": list(workspace.get("warnings", [])),
        "decisions": ordered,
        "consequencePreview": _aggregate_consequences(ordered),
        "requiresNewUpstreamRevision": any(row["action"] in _UPSTREAM_ACTIONS for row in ordered),
        "blockers": blockers,
        "canStartCast": not blockers,
        "receipt": {
            "warningGroups": len(workspace.get("warnings", [])),
            "occurrencesReviewed": len(ordered),
            "decisionDigest": _digest(ordered),
        },
    }


def review_progression_blockers(review: Mapping[str, Any]) -> list[str]:
    """Return the durable Cast gate from an accepted Review revision."""

    return [str(value) for value in review.get("blockers", [])]


def apply_review_render_policies(
    dialogue: Mapping[str, Any], review: Mapping[str, Any]
) -> dict[str, Any]:
    """Apply accepted exclude/narrate ranges without changing source coverage."""
    occurrences = {
        str(row["id"]): row
        for warning in review.get("warningSnapshot", [])
        for row in warning.get("occurrences", [])
    }
    policies: dict[str, list[tuple[int, int, str, str]]] = defaultdict(list)
    for decision in review.get("decisions", []):
        action = str(decision.get("action", ""))
        if action not in {"exclude", "narrate"}:
            continue
        occurrence_id = str(decision.get("occurrenceId", ""))
        occurrence = occurrences.get(occurrence_id)
        if occurrence is None:
            raise ReviewContractError(
                f"Review decision has no durable occurrence evidence: {occurrence_id}"
            )
        policies[str(occurrence["blockId"])].append(
            (
                int(occurrence["sourceStart"]),
                int(occurrence["sourceEnd"]),
                action,
                occurrence_id,
            )
        )

    result: list[dict[str, Any]] = []
    for raw in dialogue.get("spans", []):
        span = dict(raw)
        start = int(span.get("sourceStart", 0))
        end = int(span.get("sourceEnd", 0))
        overlaps = [
            row
            for row in policies.get(str(span.get("blockId", "")), [])
            if max(start, row[0]) < min(end, row[1])
        ]
        if not overlaps:
            result.append(span)
            continue
        cuts = {start, end}
        for policy_start, policy_end, _action, _occurrence_id in overlaps:
            cuts.update((max(start, policy_start), min(end, policy_end)))
        ordered = sorted(cuts)
        for piece_start, piece_end in zip(ordered, ordered[1:]):
            owners = [row for row in overlaps if row[0] <= piece_start and piece_end <= row[1]]
            if owners:
                narrowest_width = min(row[1] - row[0] for row in owners)
                owners = [row for row in owners if row[1] - row[0] == narrowest_width]
            if len({row[2] for row in owners}) > 1:
                raise ReviewContractError(
                    f"Conflicting Review render policies overlap {span.get('blockId')} "
                    f"at {piece_start}-{piece_end}"
                )
            owner = owners[0] if owners else None
            action = owner[2] if owner is not None else "keep"
            occurrence_id = owner[3] if owner is not None else None
            result.append(_review_policy_span(span, piece_start, piece_end, action, occurrence_id))
    return {**dict(dialogue), "spans": result}


def preview_review_transcript_page(
    extraction: Mapping[str, Any],
    dialogue: Mapping[str, Any],
    workspace: Mapping[str, Any],
    policies: Sequence[Mapping[str, Any]],
    *,
    page: int,
    page_count: int | None = None,
) -> dict[str, Any]:
    """Render one read-only page of the would-be accepted audiobook transcript."""

    blocks = list(extraction.get("blocks", []))
    block_pages = {
        str(block.get("id", "")): int(block.get("page", 1))
        for block in blocks
    }
    total_pages = page_count or max((int(block.get("page", 1)) for block in blocks), default=1)
    if not 1 <= page <= total_pages:
        raise ReviewContractError(f"Transcript preview page must be between 1 and {total_pages}")

    warnings = {str(row.get("id", "")): row for row in workspace.get("warnings", [])}
    occurrences = {
        str(occurrence.get("id", "")): occurrence
        for warning in warnings.values()
        for occurrence in warning.get("occurrences", [])
    }
    chosen: dict[str, str] = {}
    for raw in policies:
        warning_id = str(raw.get("warningId", ""))
        action = str(raw.get("action", ""))
        if not warning_id or warning_id in chosen:
            raise ReviewContractError("Transcript preview policies must identify unique warning groups")
        warning = warnings.get(warning_id)
        if warning is None:
            raise ReviewContractError(f"Unknown Review warning group: {warning_id}")
        for occurrence in warning.get("occurrences", []):
            _validate_action(occurrence, action)
        chosen[warning_id] = action

    missing = sorted(set(warnings) - set(chosen))
    if missing:
        raise ReviewContractError(
            "Every Review warning group must be decided before previewing the final transcript"
        )

    decisions = [
        {"occurrenceId": str(occurrence["id"]), "action": chosen[warning_id]}
        for warning_id, warning in warnings.items()
        for occurrence in warning.get("occurrences", [])
    ]
    rendered = apply_review_render_policies(
        dialogue,
        {"warningSnapshot": list(warnings.values()), "decisions": decisions},
    )

    rows: list[dict[str, Any]] = []
    for span in rendered.get("spans", []):
        span_page = int(span.get("page") or block_pages.get(str(span.get("blockId", "")), 1))
        if span_page != page:
            continue
        review_action = str(span.get("reviewAction", "keep"))
        render_role = str(span.get("renderRole", "narration"))
        if review_action == "exclude":
            kind = "excluded"
            reader = "Not spoken"
            text = str(span.get("source", ""))
        elif render_role == "dialogue":
            kind = "dialogue"
            reader = (
                "Narrator"
                if str(span.get("fallback", "")).casefold() == "narrator"
                or str(span.get("speakerStatus", "")).casefold()
                in {"unresolved", "open-marker"}
                else str(
                    span.get("resolvedSpeakerLabel")
                    or span.get("sourceSpeakerLabel")
                    or "Narrator"
                )
            )
            text = str(span.get("text") or span.get("source", ""))
        else:
            kind = "narration"
            reader = "Narrator"
            text = str(span.get("text") or span.get("source", ""))
        text = text.strip()
        if not text:
            continue
        if kind != "excluded" and not any(character.isalnum() for character in text):
            continue
        occurrence = occurrences.get(str(span.get("reviewOccurrenceId", "")))
        rows.append(
            {
                "id": str(span.get("id", "")),
                "kind": kind,
                "reader": reader,
                "text": text,
                "blockId": str(span.get("blockId", "")),
                "sourceStart": int(span.get("sourceStart", 0)),
                "sourceEnd": int(span.get("sourceEnd", 0)),
                "warningKind": str(occurrence.get("kind", "")) if occurrence else None,
            }
        )

    summary = {
        "spoken": sum(row["kind"] != "excluded" for row in rows),
        "dialogue": sum(row["kind"] == "dialogue" for row in rows),
        "excluded": sum(row["kind"] == "excluded" for row in rows),
    }
    return {"page": page, "pageCount": total_pages, "spans": rows, "summary": summary}


def _review_policy_span(
    span: Mapping[str, Any],
    start: int,
    end: int,
    action: str,
    occurrence_id: str | None,
) -> dict[str, Any]:
    original_start = int(span.get("sourceStart", 0))
    source = str(span.get("source", ""))[start - original_start : end - original_start]
    split = start != original_start or end != int(span.get("sourceEnd", 0))
    structural_omission = False
    spoken_start, spoken_end = start, end
    spoken_text = source
    if action == "keep":
        spoken_start = max(start, int(span.get("spokenStart", original_start)))
        spoken_end = min(end, int(span.get("spokenEnd", span.get("sourceEnd", end))))
        if spoken_start >= spoken_end:
            # Keep label/quote delimiters as source evidence, never new speech.
            action = "exclude"
            structural_omission = True
            spoken_start, spoken_end = start, end
        else:
            spoken_text = source[spoken_start - start : spoken_end - start]
    row = {
        **dict(span),
        "id": f"{span['id']}:review:{start}-{end}" if split else str(span["id"]),
        "sourceStart": start,
        "sourceEnd": end,
        "spokenStart": spoken_start,
        "spokenEnd": spoken_end,
        "source": source,
        "text": "" if action == "exclude" else spoken_text,
        "reviewAction": action,
        "reviewOccurrenceId": occurrence_id,
    }
    if action in {"narrate", "exclude"}:
        row.update(
            {
                "renderRole": "narration",
                "sourceSpeakerLabel": None,
                "resolvedSpeakerLabel": None,
                "speakerStatus": "not-applicable",
                "fallback": None,
                "origin": f"review:{action}",
            }
        )
    if structural_omission:
        row["origin"] = "source-delimiter"
    return row


def _required_revision(artifact: Mapping[str, Any], label: str) -> str:
    revision = str(artifact.get("revision", "")).strip()
    if not revision:
        raise ReviewContractError(f"{label} revision is required")
    return revision


def _normalise_blocks(extraction: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_blocks = extraction.get("blocks")
    if raw_blocks is None:
        raw_blocks = extraction.get("pages", [])
    blocks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_blocks):
        block_id = str(raw.get("id") or f"page:{raw.get('page', index + 1)}")
        if block_id in seen:
            raise ReviewContractError(f"Duplicate extraction block ID: {block_id}")
        seen.add(block_id)
        blocks.append(
            {
                **raw,
                "id": block_id,
                "page": int(raw.get("page", index + 1)),
                "text": str(raw.get("text", "")),
                "sourceOrder": index,
            }
        )
    if not blocks:
        raise ReviewContractError("Extraction contains no source blocks")
    return blocks


def _coverage_occurrences(
    blocks: Sequence[Mapping[str, Any]], spans: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    by_block: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for span in spans:
        by_block[str(span.get("blockId", ""))].append(span)
    result: list[dict[str, Any]] = []
    known = {str(block["id"]) for block in blocks}
    invented = sorted(set(by_block) - known)
    for block_id in invented:
        result.append(
            _occurrence(
                "malformed-coverage",
                block_id,
                0,
                0,
                "",
                0,
                "Dialogue references a source block that extraction does not contain.",
            )
        )
    for block in blocks:
        block_id = str(block["id"])
        text = str(block["text"])
        ordered = sorted(
            by_block.get(block_id, []),
            key=lambda row: (int(row.get("sourceStart", 0)), int(row.get("sourceEnd", 0))),
        )
        cursor = 0
        reason = None
        for span in ordered:
            start = int(span.get("sourceStart", 0))
            end = int(span.get("sourceEnd", 0))
            if start != cursor or end < start or end > len(text):
                reason = "Dialogue spans leave a gap, overlap, or invalid source range."
                break
            source = str(span.get("source", text[start:end]))
            if source != text[start:end]:
                reason = "Dialogue span evidence does not equal its extraction source range."
                break
            cursor = end
        if reason is None and cursor != len(text):
            reason = "Dialogue spans do not cover the complete extraction block."
        if reason:
            result.append(
                _occurrence(
                    "malformed-coverage",
                    block_id,
                    0,
                    len(text),
                    text,
                    int(block["page"]),
                    reason,
                )
            )
    return result


def _empty_occurrences(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Report one warning for a wholly empty page, not empty layout fragments."""
    by_page: dict[int, list[Mapping[str, Any]]] = defaultdict(list)
    for block in blocks:
        by_page[int(block["page"])].append(block)
    return [
        _occurrence(
            "empty-page",
            str(page_blocks[0]["id"]),
            0,
            0,
            "",
            page,
            "No text was extracted from this page.",
        )
        for page, page_blocks in by_page.items()
        if not any(str(block["text"]).strip() for block in page_blocks)
    ]


def _stage_direction_occurrences(blocks, spans):
    """Offer explicit script parentheticals for review; never strip prose globally."""
    by_id = {str(block["id"]): block for block in blocks}
    result = []
    for span in spans:
        prefix = str(span.get("source", ""))[:int(span.get("spokenStart", 0)) - int(span.get("sourceStart", 0))]
        if span.get("origin") != "regex:label-colon-line" and not (
            span.get("renderRole") == "dialogue" and re.fullmatch(r"\s*[^:()]+:\s*", prefix)
        ):
            continue
        block = by_id.get(str(span.get("blockId")))
        if block is None:
            continue
        text = str(block["text"])
        start = int(span["spokenStart"])
        end = int(span["spokenEnd"])
        if not 0 <= start < end <= len(text):
            # Existing coverage diagnostics own malformed source boundaries.
            continue
        depth = 0
        cue_start = None
        ranges = []
        for offset in range(start, end):
            if text[offset] == "(":
                if depth == 0:
                    cue_start = offset
                depth += 1
            elif text[offset] == ")" and depth:
                depth -= 1
                if depth == 0:
                    ranges.append((cue_start, offset + 1))
        for cue_start, cue_end in ranges:
            result.append(_occurrence(
                "stage-direction", str(block["id"]), cue_start, cue_end,
                text[cue_start:cue_end], int(block["page"]),
                "Parenthetical script direction. Leave delivery and sound cues unspoken, "
                "or choose the narrator for descriptive action.", block_text=text,
            ))
    return result


def _text_occurrences(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result = _footnote_occurrences(blocks)
    edge_lines: dict[str, list[tuple[Mapping[str, Any], int, int, str]]] = defaultdict(list)
    page_blocks: dict[int, list[str]] = defaultdict(list)
    for block in blocks:
        page_blocks[int(block["page"])].append(str(block["id"]))
    for block in blocks:
        text = str(block["text"])
        lines = list(re.finditer(r"[^\n]+", text))
        siblings = page_blocks[int(block["page"])]
        block_id = str(block["id"])
        is_first_block = block_id == siblings[0]
        is_last_block = block_id == siblings[-1]
        for line_index, match in enumerate(lines):
            value = match.group(0)
            stripped = value.strip()
            if not stripped:
                continue
            for web_match in _WEB_ADDRESS.finditer(value):
                web_end = web_match.end()
                while (
                    web_end > web_match.start()
                    and value[web_end - 1] in _WEB_ADDRESS_TRAILING_PUNCTUATION
                ):
                    web_end -= 1
                if web_end > web_match.start():
                    start = match.start() + web_match.start()
                    end = match.start() + web_end
                    result.append(
                        _occurrence(
                            "web-address",
                            str(block["id"]),
                            start,
                            end,
                            text[start:end],
                            int(block["page"]),
                            "Web address that may not belong in the spoken edition.",
                            block_text=text,
                        )
                    )
            if "�" in value or re.search(r"(?:\w\s){4,}\w", value):
                result.append(
                    _from_match(
                        "suspicious-extraction",
                        block,
                        match,
                        "Possible OCR/extraction corruption.",
                    )
                )
            is_edge = (is_first_block and line_index < 2) or (
                is_last_block and line_index >= max(0, len(lines) - 2)
            )
            if is_edge and _PAGE_NUMBER.fullmatch(stripped):
                result.append(
                    _from_match("page-number", block, match, "Page-number-shaped edge line.")
                )
            elif _PERIPHERAL.match(stripped):
                result.append(
                    _from_match(
                        "front-back-matter", block, match, "Front/back/editorial matter candidate."
                    )
                )
            if is_edge and len(stripped) >= 3 and not _PAGE_NUMBER.fullmatch(stripped):
                edge_lines[" ".join(stripped.casefold().split())].append(
                    (block, match.start(), match.end(), value)
                )

    for rows in edge_lines.values():
        if len({int(row[0]["page"]) for row in rows}) < 2:
            continue
        repeated_top_title = (
            len(rows[0][3].strip()) >= 12
            and not re.search(r":\s*\[", rows[0][3])
            and all(row[1] == 0 for row in rows)
        )
        if not (_looks_like_page_furniture(rows[0][3]) or repeated_top_title):
            continue
        for block, start, end, value in rows:
            result.append(
                _occurrence(
                    "repeated-matter",
                    str(block["id"]),
                    start,
                    end,
                    value,
                    int(block["page"]),
                    "The same edge line repeats on multiple pages.",
                    block_text=str(block["text"]),
                )
            )
    return result


def _footnote_occurrences(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Anchor complete notes only while an explicit note section is active."""
    result: list[dict[str, Any]] = []
    section_active = False
    pending_tail: str | None = None
    previous_page: int | None = None

    for block in blocks:
        text = str(block["text"])
        lines = [match for match in re.finditer(r"[^\n]+", text) if match.group(0).strip()]
        if not lines:
            continue
        page = int(block["page"])
        if previous_page is not None and page > previous_page + 1:
            section_active = False
            pending_tail = None

        line_index = 0
        first = lines[0]
        first_value = first.group(0).strip()
        if section_active and pending_tail is not None:
            if _is_footnote_marker(first_value) or _NOTE_SECTION_HEADER.fullmatch(first_value):
                pending_tail = None
            elif _continues_note_across_block(pending_tail, first_value, previous_page, page):
                end_index = _note_range_end(text, lines, 0)
                end_match = lines[end_index - 1]
                result.append(
                    _occurrence(
                        "footnote",
                        str(block["id"]),
                        first.start(),
                        end_match.end(),
                        text[first.start() : end_match.end()],
                        page,
                        "Continuation of a footnote from the previous source block.",
                        block_text=text,
                    )
                )
                line_index = end_index
                pending_tail = end_match.group(0) if end_index == len(lines) else None
            else:
                section_active = False
                pending_tail = None
        elif (
            section_active
            and not _is_footnote_marker(first_value)
            and not _NOTE_SECTION_HEADER.fullmatch(first_value)
        ):
            section_active = False

        while line_index < len(lines):
            match = lines[line_index]
            stripped = match.group(0).strip()
            if _NOTE_SECTION_HEADER.fullmatch(stripped):
                section_active = True
                pending_tail = None
                line_index += 1
                continue
            if _is_note_section_boundary(stripped):
                section_active = False
                pending_tail = None
                line_index += 1
                continue
            if not _is_footnote_marker(stripped):
                line_index += 1
                continue

            end_index = (
                _note_range_end(text, lines, line_index)
                if section_active
                else line_index + 1
            )
            end_match = lines[end_index - 1]
            result.append(
                _occurrence(
                    "footnote",
                    str(block["id"]),
                    match.start(),
                    end_match.end(),
                    text[match.start() : end_match.end()],
                    page,
                    (
                        "Footnote in an explicit note section."
                        if section_active
                        else "Footnote-shaped line."
                    ),
                    block_text=text,
                )
            )
            pending_tail = end_match.group(0) if section_active and end_index == len(lines) else None
            line_index = end_index

        previous_page = page

    return result


def _note_range_end(text: str, lines: Sequence[re.Match[str]], start: int) -> int:
    for index in range(start + 1, len(lines)):
        previous = lines[index - 1]
        current = lines[index]
        stripped = current.group(0).strip()
        if text[previous.end() : current.start()].count("\n") > 1:
            return index
        if (
            _is_footnote_marker(stripped)
            or _NOTE_SECTION_HEADER.fullmatch(stripped)
            or _is_note_section_boundary(stripped)
        ):
            return index
    return len(lines)


def _is_footnote_marker(value: str) -> bool:
    return bool(_FOOTNOTE.match(value) and not _CHAPTER_LIST_ENTRY.match(value))


def _is_note_section_boundary(value: str) -> bool:
    return bool(_NOTE_SECTION_BOUNDARY.match(value))


def _continues_note_across_block(
    previous_line: str,
    next_line: str,
    previous_page: int | None,
    page: int,
) -> bool:
    if previous_page is None or page > previous_page + 1:
        return False
    if _is_note_section_boundary(next_line):
        return False
    previous = previous_line.rstrip()
    if previous.endswith(("-", "‐", "‑")):
        return True
    if re.search(r"[.!?…][\"')\]]*$", previous):
        return False
    first = next_line.lstrip()[:1]
    return bool(first and not first.isupper())


def _looks_like_page_furniture(value: str) -> bool:
    """Conservatively distinguish repeated furniture from repeated novel prose."""
    stripped = value.strip()
    folded = stripped.casefold()
    if re.search(r":\s*\[", stripped):
        return False
    if re.search(r"https?://|www\.|@\w|\b(?:translated|proofread|translation notes?|art sources?)\b", folded):
        return True
    alphanumeric = sum(character.isalnum() for character in stripped)
    return bool(stripped) and alphanumeric / len(stripped) < 0.35


def _metadata_occurrences(
    extraction: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    block_index = {str(block["id"]): block for block in blocks}
    result: list[dict[str, Any]] = []
    categories = {
        "layout": "reading-order",
        "reading-order": "reading-order",
        "columns": "reading-order",
        "ocr": "suspicious-extraction",
        "extraction": "suspicious-extraction",
        "hyphenation": "suspicious-extraction",
    }
    rows = [*extraction.get("warnings", []), *extraction.get("boundaryCandidates", [])]
    for index, raw in enumerate(rows):
        category = str(raw.get("kind") or raw.get("code") or "").casefold()
        kind = next((value for key, value in categories.items() if key in category), None)
        if kind is None:
            continue
        # Chapter candidates have their own explicit confirmation contract. Showing the
        # same evidence again as a generic source warning creates a second, conflicting
        # decision. Page-level extraction warnings are likewise only signals; precise
        # source ranges are detected above and are the only safe editable evidence.
        has_range = any(key in raw for key in ("sourceStart", "sourceEnd", "start", "end"))
        if kind == "suspicious-extraction" and not has_range:
            continue
        block_id = str(raw.get("blockId") or "")
        block = block_index.get(block_id)
        if block is None:
            page = int(raw.get("page", 0))
            block = next((row for row in blocks if int(row["page"]) == page), blocks[0])
            block_id = str(block["id"])
        text = str(block["text"])
        start = max(0, int(raw.get("sourceStart", raw.get("start", 0))))
        end = min(len(text), int(raw.get("sourceEnd", raw.get("end", len(text)))))
        result.append(
            _occurrence(
                kind,
                block_id,
                start,
                end,
                text[start:end],
                int(block["page"]),
                str(
                    raw.get("label")
                    or raw.get("reason")
                    or f"Extractor {kind} warning {index + 1}."
                ),
                block_text=text,
            )
        )
    return result


def _from_match(
    kind: str, block: Mapping[str, Any], match: re.Match[str], reason: str
) -> dict[str, Any]:
    return _occurrence(
        kind,
        str(block["id"]),
        match.start(),
        match.end(),
        match.group(0),
        int(block["page"]),
        reason,
        block_text=str(block["text"]),
    )


def _occurrence(
    kind: str,
    block_id: str,
    start: int,
    end: int,
    source: str,
    page: int,
    reason: str,
    *,
    block_text: str | None = None,
) -> dict[str, Any]:
    config = WARNING_CONFIG.get(kind) or _INTERNAL_WARNING_CONFIG[kind]
    occurrence_id = f"review:{kind}:{block_id}:{start}-{end}"
    evidence = block_text if block_text is not None else source
    return {
        "id": occurrence_id,
        "kind": kind,
        "blockId": block_id,
        "page": page,
        "sourceStart": start,
        "sourceEnd": end,
        "source": source,
        "contextBefore": evidence[max(0, start - 180) : start],
        "contextAfter": evidence[end : end + 180],
        "reason": reason,
        "severity": config["severity"],
        "availableActions": list(config["actions"]),
        "matchKey": hashlib.sha256(
            f"{kind}\0{' '.join(source.casefold().split())}".encode()
        ).hexdigest()[:20],
    }


def _deduplicate_occurrences(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        existing = result.get(row["id"])
        if existing is None:
            result[row["id"]] = row
        elif row["reason"] not in existing["reason"]:
            existing["reason"] += " " + row["reason"]
    return list(result.values())


def _add_adjacent_context(
    occurrences: Sequence[dict[str, Any]], blocks: Sequence[Mapping[str, Any]]
) -> None:
    """Fill missing context from neighboring non-empty extraction blocks."""
    positions = {str(block["id"]): index for index, block in enumerate(blocks)}
    for occurrence in occurrences:
        position = positions.get(str(occurrence["blockId"]))
        if position is None:
            continue
        if not occurrence["contextBefore"]:
            for block in reversed(blocks[:position]):
                text = str(block["text"]).strip()
                if text:
                    occurrence["contextBefore"] = text[-180:]
                    break
        if not occurrence["contextAfter"]:
            for block in blocks[position + 1 :]:
                text = str(block["text"]).strip()
                if text:
                    occurrence["contextAfter"] = text[:180]
                    break


def _group_occurrences(
    rows: Sequence[dict[str, Any]], spans: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    spans_by_block: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for span in spans:
        spans_by_block[str(span.get("blockId", ""))].append(span)

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        row["readerState"] = _occurrence_reader_state(
            row, spans_by_block.get(str(row.get("blockId", "")), [])
        )
        grouped[row["kind"]].append(row)
    result: list[dict[str, Any]] = []
    for kind in WARNING_CONFIG:
        occurrences = sorted(
            grouped.get(kind, []), key=lambda row: (row["page"], row["blockId"], row["sourceStart"])
        )
        if not occurrences:
            continue
        evidence_groups: list[list[dict[str, Any]]]
        if kind == "repeated-matter":
            by_match: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for occurrence in occurrences:
                by_match[str(occurrence["matchKey"])].append(occurrence)
            evidence_groups = list(by_match.values())
        else:
            evidence_groups = [occurrences]
        for evidence_group in evidence_groups:
            reader_state = _combined_reader_state(
                [str(row["readerState"]) for row in evidence_group]
            )
            available_actions = list(WARNING_CONFIG[kind]["actions"])
            if reader_state == "narrator":
                available_actions = [
                    action for action in available_actions if action != "narrate"
                ]
            for occurrence in evidence_group:
                occurrence["availableActions"] = list(available_actions)
            suffix = (
                f":{evidence_group[0]['matchKey']}"
                if kind == "repeated-matter"
                else ""
            )
            warning_id = f"review:{kind}{suffix}"
            for occurrence in evidence_group:
                occurrence["warningId"] = warning_id
            result.append(
                {
                    "id": warning_id,
                    "kind": kind,
                    "severity": WARNING_CONFIG[kind]["severity"],
                    "occurrenceCount": len(evidence_group),
                    "decisionScope": (
                        "identical-evidence"
                        if kind == "repeated-matter"
                        else "warning-kind"
                    ),
                    "bulkScope": "identical-evidence",
                    "availableActions": available_actions,
                    "readerState": reader_state,
                    "occurrences": evidence_group,
                }
            )
    return result


def _occurrence_reader_state(
    occurrence: Mapping[str, Any], spans: Sequence[Mapping[str, Any]]
) -> str:
    start = int(occurrence.get("sourceStart", 0))
    end = int(occurrence.get("sourceEnd", 0))
    states = {
        _span_reader_state(span)
        for span in spans
        if max(start, int(span.get("sourceStart", 0)))
        < min(end, int(span.get("sourceEnd", 0)))
    }
    return _combined_reader_state(sorted(states))


def _span_reader_state(span: Mapping[str, Any]) -> str:
    if str(span.get("renderRole", "narration")) != "dialogue":
        return "narrator"
    if str(span.get("speakerStatus", "")).casefold() in {
        "unresolved",
        "open-marker",
        "not-applicable",
    }:
        return "narrator"
    labels = span.get("speakerLabels")
    if labels is None:
        labels = [span.get("resolvedSpeakerLabel") or span.get("sourceSpeakerLabel")]
    if not any(str(label or "").strip() for label in labels):
        return "narrator"
    return "assigned-speaker"


def _combined_reader_state(states: Sequence[str]) -> str:
    distinct = {state for state in states if state}
    if distinct == {"assigned-speaker"}:
        return "assigned-speaker"
    if "assigned-speaker" in distinct or "mixed" in distinct:
        return "mixed"
    return "narrator"


def _source_reconstruction(
    blocks: Sequence[Mapping[str, Any]], spans: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    failures = _coverage_occurrences(blocks, spans)
    return {
        "status": "failed" if failures else "exact",
        "blocksChecked": len(blocks),
        "failureOccurrenceIds": [row["id"] for row in failures],
    }


def _occurrence_index(workspace: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for warning in workspace.get("warnings", []):
        for raw in warning.get("occurrences", []):
            row = dict(raw)
            row.setdefault("warningId", str(warning.get("id", "")))
            occurrence_id = str(row.get("id", ""))
            if not occurrence_id or occurrence_id in result:
                raise ReviewContractError("Warning occurrence IDs must be present and unique")
            result[occurrence_id] = row
    return result


def _validate_action(occurrence: Mapping[str, Any], action: str) -> None:
    if action not in occurrence.get("availableActions", []):
        raise ReviewContractError(
            f"Action {action!r} is not supported for {occurrence.get('kind')}"
        )


def _preview_token(workspace: Mapping[str, Any], target_ids: Sequence[str], action: str) -> str:
    return _digest(
        {
            "extractionRevision": workspace.get("extractionRevision"),
            "dialogueRevision": workspace.get("dialogueRevision"),
            "targetOccurrenceIds": list(target_ids),
            "action": action,
        }
    )


def _consequence(action: str, count: int) -> dict[str, Any]:
    return {
        "affectedOccurrences": count,
        "audio": (
            "excluded"
            if action == "exclude"
            else "narrator"
            if action == "narrate"
            else "unchanged"
        ),
        "sourcePreserved": True,
        "requiresNewUpstreamRevision": action in _UPSTREAM_ACTIONS,
        "downstreamInvalidation": (
            ["dialogue", "review", "cast", "script", "generate"]
            if action == "rerun-extraction"
            else ["review", "cast", "script", "generate"]
            if action == "rerun-dialogue"
            else ["generate"]
            if action in {"exclude", "narrate"}
            else []
        ),
    }


def _aggregate_consequences(decisions: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = defaultdict(int)
    invalidated: set[str] = set()
    for row in decisions:
        action = str(row["action"])
        counts[action] += 1
        invalidated.update(row["consequence"]["downstreamInvalidation"])
    return {
        "byAction": dict(sorted(counts.items())),
        "downstreamInvalidation": sorted(invalidated),
        "sourcePreserved": True,
    }


def _blockers(
    workspace: Mapping[str, Any],
    decisions: Sequence[Mapping[str, Any]],
    occurrence_index: Mapping[str, Mapping[str, Any]],
) -> list[str]:
    blockers: list[str] = []
    if workspace.get("sourceReconstruction", {}).get("status") != "exact":
        blockers.append("Restore exact Extraction-to-Dialogue source coverage")
    for row in decisions:
        occurrence = occurrence_index[str(row["occurrenceId"])]
        if row["action"] in _UPSTREAM_ACTIONS:
            blockers.append(f"Publish the requested upstream repair for {row['occurrenceId']}")
        elif occurrence.get("severity") == "blocking" and not (
            occurrence.get("kind") == "empty-page" and row["action"] == "keep"
        ):
            blockers.append(f"Resolve blocking warning {row['occurrenceId']}")
    return sorted(set(blockers))


def _digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()
