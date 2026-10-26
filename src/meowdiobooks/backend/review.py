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
from copy import deepcopy
from typing import Any

from .review_context import add_source_context


class ReviewContractError(ValueError):
    """Raised when a Review revision would be ambiguous or lossy."""


WARNING_CONFIG: dict[str, dict[str, Any]] = {
    "hyphenation": {
        "severity": "warning",
        "actions": ("keep-hyphen", "join-word"),
    },
    "ai-cleanup": {
        "severity": "warning",
        "actions": ("keep", "exclude", "repair"),
    },
    "stage-direction": {
        "severity": "warning",
        "actions": ("keep", "exclude", "narrate"),
    },
    "empty-page": {
        "severity": "blocking",
        "actions": ("keep",),
    },
    "suspicious-extraction": {
        "severity": "warning",
        "actions": ("keep", "narrate", "exclude"),
    },
    "reading-order": {
        "severity": "warning",
        "actions": ("keep",),
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
# Exact whole-line hints only open a note section; marker and boundary checks still
# determine the review range. These are multilingual recall hints, not deletion rules.
_NOTE_SECTION_HEADER = re.compile(
    r"^\s*(?:(?:translator(?:'s)?|translation|tl)\s+notes?|"
    r"notes?\s+(?:du\s+traducteur|de\s+traduction)|"
    r"anmerkungen?\s+(?:des\s+übersetzers|zur\s+übersetzung)|übersetzeranmerkungen|"
    r"note\s+(?:del\s+traduttore|di\s+traduzione)|"
    r"notas?\s+(?:del\s+traductor|de\s+traducción|do\s+tradutor|de\s+tradução)|"
    r"примечания?\s+переводчика|译者注|譯者註|翻译注释|翻譯註釋|"
    r"訳注|翻訳者注|訳者注|번역자\s*주|역자\s*주)\s*[:：]?\s*$", re.IGNORECASE,
)
_LINE_HYPHEN = re.compile(r"(?<![\w-])[A-Za-z]{2,}[-\u00ad][ \t\r]*\n[ \t]*[a-z]{2,}(?![\w-])")


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
    occurrences.extend(_text_occurrences(blocks, spans))
    occurrences.extend(_metadata_occurrences(extraction, blocks))
    occurrences = _deduplicate_occurrences(occurrences)
    add_source_context(occurrences, blocks)
    warnings = _group_occurrences(occurrences, spans)
    boundaries = deepcopy(list(extraction.get("boundaryCandidates", [])))
    add_source_context(boundaries, blocks)

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
        "boundaryCandidates": boundaries,
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


def _validate_pattern_groups(result, candidates, spans):
    """Bind family verdicts and individual vetoes to their exact source window identities."""
    from .cleanup_patterns import pattern_verdict, representative_windows

    grouped = result.get("patternGroups", [])
    evidence = [row for row in result.get("windows", []) if row.get("patternGroupId")]
    by_window = {f"{row['blockId']}:{row['sourceStart']}-{row['sourceEnd']}": row
                 for row in candidates.values()}
    if (len({row.get("patternGroupId") for row in grouped}) != len(grouped)
            or len({row.get("windowId") for row in evidence}) != len(evidence)
            or {row.get("patternGroupId") for row in evidence} != {row.get("patternGroupId") for row in grouped}):
        raise ReviewContractError("Pattern evidence must have unique complete group and window identities")
    for group in grouped:
        members = [row for row in evidence if row["patternGroupId"] == group["patternGroupId"]]
        eligible = []
        for member in members:
            candidate = by_window.get(member.get("windowId"))
            answers = member.get("answers", {})
            if (candidate is None or candidate["patternGroupId"] != group["patternGroupId"]
                    or member.get("patternVerdict") != group.get("verdict")
                    or set(answers) != {"production", "word_damage"}
                    or any(value not in {"clean", "review", "uncertain"} for value in answers.values())
                    or not any(str(span.get("blockId")) == candidate["blockId"]
                               and span.get("renderRole") == "narration"
                               and span.get("spokenStart", span.get("sourceStart", 0)) <= candidate["sourceStart"]
                               and candidate["sourceEnd"] <= span.get("spokenEnd", span.get("sourceEnd", 0))
                               for span in spans)):
                raise ReviewContractError("Pattern evidence must match exact narrator source windows")
            expected_status = ("eligible" if answers["production"] == "review" else "vetoed") if answers["word_damage"] == "clean" else None
            if member.get("patternStatus") != expected_status:
                raise ReviewContractError("Pattern eligibility disagrees with its contextual assessment")
            if expected_status == "eligible":
                eligible.append(member)
        representatives = representative_windows(eligible)
        if (type(group.get("candidateCount")) is not int or group["candidateCount"] != len(members)
                or type(group.get("eligibleCount")) is not int or group["eligibleCount"] != len(eligible)
                or group.get("eligibleWindowIds") != [row["windowId"] for row in eligible]
                or group.get("representativeWindowIds") != [row["windowId"] for row in representatives]
                or group.get("vetoes") != [{"windowId": row["windowId"], "answers": row["answers"]}
                                          for row in members if row not in eligible]):
            raise ReviewContractError("Pattern counts and representatives must match individual assessments")
        verdict = "insufficient" if len(eligible) < 3 else pattern_verdict(group.get("verification"), representatives)[0]
        if group.get("verdict") != verdict:
            raise ReviewContractError("Pattern verdict must match its complete representative verification")
    return {"groups": deepcopy(grouped), "windows": deepcopy(evidence)}


def add_cleanup_proposals(
    workspace: Mapping[str, Any], extraction: Mapping[str, Any],
    dialogue: Mapping[str, Any], result: Mapping[str, Any],
) -> dict[str, Any]:
    """Attach validated model suggestions without changing any accepted source."""
    if result.get("unifiedSuggestions") is True and any(
        not any(proposal.get(key) is not None for key in ("hyphenDecision", "editorialFamilyId", "patternGroupId"))
        for proposal in result.get("occurrences", [])
    ):
        raise ReviewContractError("Unified suggestions require verified source-bound evidence")
    editorial_evidence = result.get("focusedReview")
    editorial_proposals = []
    if editorial_evidence is not None:
        from .cleanup_editorial import verified_editorial_occurrences
        try:
            editorial_proposals = verified_editorial_occurrences(extraction, dialogue, editorial_evidence)
        except (ValueError, TypeError, KeyError) as exc:
            raise ReviewContractError(str(exc)) from exc
        if [p for p in result.get("occurrences", []) if p.get("editorialFamilyId") is not None] != editorial_proposals:
            raise ReviewContractError("Editorial proposals differ from their verified evidence")
    elif any(p.get("editorialFamilyId") is not None for p in result.get("occurrences", [])):
        raise ReviewContractError("Editorial proposals require source-bound evidence")
    chapter_evidence = result.get("chapterReview")
    if chapter_evidence is not None:
        from .chapter_semantic import validate_chapter_review
        try:
            boundaries = validate_chapter_review(extraction, dialogue, chapter_evidence, footer_evidence=result)
        except (ValueError, TypeError, KeyError) as exc:
            raise ReviewContractError(str(exc)) from exc
        add_source_context(boundaries, _normalise_blocks(extraction))
        workspace = {**workspace, "boundaryCandidates": boundaries}
    hyphen_evidence = result.get("hyphenReview")
    if hyphen_evidence is not None:
        from .hyphen_review import validated_hyphen_proposals
        try:
            hyphen_proposals = validated_hyphen_proposals(extraction, dialogue, hyphen_evidence)
        except (ValueError, TypeError, KeyError) as exc:
            raise ReviewContractError(str(exc)) from exc
        actual = [p for p in result.get("occurrences", []) if p.get("hyphenDecision") is not None]
        hyphen_proposals = [p for p in hyphen_proposals if not any(
            e["blockId"] == p["blockId"] and e["sourceStart"] <= p["sourceStart"]
            and p["sourceEnd"] <= e["sourceEnd"] for e in editorial_proposals)]
        if actual != hyphen_proposals:
            raise ReviewContractError("Cleanup hyphens differ from their verified evidence")
        workspace = {**workspace, "warnings": [w for w in workspace.get("warnings", [])
                                               if w.get("kind") != "hyphenation"]}
    elif any(p.get("hyphenDecision") is not None for p in result.get("occurrences", [])):
        raise ReviewContractError("Hyphen decisions require source-bound evidence")
    blocks = _normalise_blocks(extraction)
    index = {str(block["id"]): block for block in blocks}
    cue_rows = _verified_script_occurrences(blocks, dialogue, result.get("scriptDirections", {}))
    rows = []
    pattern_candidates = {(row["blockId"], row["sourceStart"], row["sourceEnd"]): row
                          for row in numbered_edge_candidates(blocks)}
    family_rule_mode = result.get("patternAssessmentMode") == "numbered-footer-rule-v1"
    if family_rule_mode:
        from .cleanup_patterns import validate_family_rule_evidence
        try:
            pattern_evidence = validate_family_rule_evidence(extraction, dialogue, result)
        except (ValueError, TypeError, KeyError) as exc:
            raise ReviewContractError(str(exc)) from exc
    else:
        pattern_evidence = _validate_pattern_groups(result, pattern_candidates, dialogue.get("spans", []))
    for proposal in result.get("occurrences", []):
        block = index.get(str(proposal.get("blockId", "")))
        start, end = proposal.get("sourceStart"), proposal.get("sourceEnd")
        if (block is None or type(start) is not int or type(end) is not int
                or not 0 <= start < end <= len(block["text"])
                or block["text"][start:end] != proposal.get("source")):
            raise ReviewContractError("Cleanup proposal does not match its exact source")
        if "scriptDirections" in result and proposal.get("hyphenDecision") is None:
            from .script_cues import bracket_ranges
            if any(max(start, left) < min(end, right)
                   for left, right in bracket_ranges(block["text"])):
                raise ReviewContractError("General cleanup cannot override protected bracketed content")
        # Explicit hyphen choices own their range; a model must not supersede them.
        if any(row.get("kind") == "hyphenation" and row["blockId"] == block["id"]
               and max(start, row["sourceStart"]) < min(end, row["sourceEnd"])
               for warning in workspace.get("warnings", [])
               for row in warning.get("occurrences", [])):
            continue
        replacement = proposal.get("replacement")
        if replacement is not None and not isinstance(replacement, str):
            raise ReviewContractError("Cleanup replacement must be text or null")
        if replacement == proposal["source"]:
            raise ReviewContractError("Cleanup proposal must change the highlighted text")
        if replacement is not None and not any(
            str(span.get("blockId")) == str(block["id"])
            and int(span.get("spokenStart", span.get("sourceStart", 0))) <= start
            and end <= int(span.get("spokenEnd", span.get("sourceEnd", 0)))
            for span in dialogue.get("spans", [])
        ):
            raise ReviewContractError("Cleanup repairs must stay inside one spoken source span")
        row = _occurrence("ai-cleanup", str(block["id"]), start, end,
                          proposal["source"], int(block["page"]),
                          str(proposal.get("reason") or "Check this text against the source."),
                          block_text=block["text"])
        row.update({"replacement": replacement,
                    "proposalStatus": "proposed" if replacement is not None else "source_review",
                    "model": "gpt-6-luna",
                    "availableActions": ["keep", "exclude", "repair"] if replacement is not None
                    else ["keep", "exclude"]})
        if proposal.get("hyphenDecision") is not None:
            row.update(hyphenDecision=proposal["hyphenDecision"], availableActions=["keep", "repair"],
                       model="decisions", recommendedAction="repair")
        if proposal.get("patternGroupId") is not None:
            candidate = pattern_candidates.get((str(block["id"]), start, end))
            group = next((group for group in result.get("patternGroups", [])
                          if group.get("patternGroupId") == proposal["patternGroupId"]), None)
            evidence = next((window for window in result.get("windows", [])
                             if window.get("windowId") == proposal.get("windowId")), None)
            if (candidate is None or group is None or evidence is None
                    or proposal.get("windowId") != f"{block['id']}:{start}-{end}"
                    or evidence.get("patternGroupId") != candidate["patternGroupId"]
                    or evidence.get("patternVerdict") != "verified"
                    or group.get("verdict") != "verified"
                    or proposal.get("windowId") not in group.get("eligibleWindowIds", [])
                    or evidence.get("patternStatus") != "eligible"
                    or (not family_rule_mode and evidence.get("answers") != {"production": "review", "word_damage": "clean"})
                    or (family_rule_mode and evidence.get("assessmentScope") != "family-rule")
                    or replacement != "" or proposal.get("patternVerification") != "verified"
                    or proposal["patternGroupId"] != candidate["patternGroupId"]
                    or not any(str(span.get("blockId")) == str(block["id"])
                               and span.get("renderRole") == "narration"
                               and span.get("spokenStart", span.get("sourceStart", 0)) <= start
                               and end <= span.get("spokenEnd", span.get("sourceEnd", 0))
                               for span in dialogue.get("spans", []))):
                raise ReviewContractError("Pattern proposal requires exact verified narrator footer evidence")
            row.update(patternGroupId=candidate["patternGroupId"], patternVerification="verified")
        # Even identical source strings can have different suggested replacements.
        row["matchKey"] = _digest([row["source"], replacement])
        rows.append(row)
    if len({row["id"] for row in rows}) != len(rows):
        raise ReviewContractError("Cleanup proposals repeat a source range")
    for index, row in enumerate(rows):
        if any(row["blockId"] == other["blockId"]
               and max(row["sourceStart"], other["sourceStart"])
               < min(row["sourceEnd"], other["sourceEnd"])
               for other in rows[:index]):
            raise ReviewContractError("Cleanup proposals overlap")
    add_source_context(rows, blocks)
    # Preserve deterministic IDs and evidence. Repairable findings move into the AI
    # category, so the same defect never asks for two decisions.
    warnings = deepcopy(list(workspace.get("warnings", [])))
    existing = [(warning, occurrence) for warning in warnings
                for occurrence in warning.get("occurrences", [])
                if occurrence.get("kind") != "ai-cleanup"]
    novel = []
    for row in rows:
        exact = [(warning, occurrence, row["replacement"])
                 for warning, occurrence in existing
                 if all(occurrence.get(key) == row[key]
                        for key in ("blockId", "sourceStart", "sourceEnd", "source"))]
        matches = [] if row.get("hyphenDecision") else exact or _project_cleanup_anchor(row, existing)
        if len(matches) != 1:
            # Partial overlaps or multiple possible owners are not proof of one issue.
            # Keep the usable proposal; never silently discard a correction.
            novel.append(row)
            continue
        warning, occurrence, replacement = matches[0]
        cleanup_reason = row["reason"]
        if occurrence.get("cleanupReason") and occurrence["cleanupReason"] != cleanup_reason:
            cleanup_reason = f"{occurrence['cleanupReason']}\n{cleanup_reason}"
        occurrence.update({
            "replacement": replacement, "proposalStatus": row["proposalStatus"],
            "model": row["model"], "cleanupReason": cleanup_reason,
            "matchKey": _digest([occurrence["source"], replacement]),
        })
        if row.get("patternGroupId"):
            occurrence.update(patternGroupId=row["patternGroupId"], patternVerification="verified")
        if replacement is not None:
            warning["occurrences"].remove(occurrence)
            occurrence.update(kind="ai-cleanup", availableActions=["keep", "exclude", "repair"])
            novel.append(occurrence)
        else:
            warning["decisionScope"] = "occurrence"
    warnings = [warning for warning in warnings if warning["occurrences"]]
    for warning in warnings:
        # Moving a correction can change both the count and the remaining reader roles.
        members = warning["occurrences"]
        warning["occurrenceCount"] = len(members)
        warning["readerState"] = _combined_reader_state(
            [str(member["readerState"]) for member in members]
        )
        for member in members:
            if (warning.get("decisionScope") == "occurrence"
                    or warning["readerState"] == "narrator") and member.get("readerState") == "narrator":
                member["availableActions"] = [action for action in member["availableActions"]
                                              if action != "narrate"]
        warning["availableActions"] = list(dict.fromkeys(
            action for member in members for action in member["availableActions"]
        ))
    warnings.extend(_group_occurrences([*cue_rows, *novel], dialogue.get("spans", [])))
    return {**dict(workspace), "warnings": warnings,
            "unifiedSuggestions": result.get("unifiedSuggestions") is True,
            "hyphenReviewEvidence": deepcopy(hyphen_evidence),
            "focusedReviewEvidence": deepcopy(editorial_evidence),
            "chapterReviewEvidence": deepcopy(chapter_evidence),
            "cleanupSummary": dict(result.get("summary", {})),
            "cleanupPatternEvidence": pattern_evidence,
            "scriptDirectionsSummary": dict(result.get("scriptDirections", {}).get("summary", {})),
            "summary": {**workspace["summary"], "groups": len(warnings),
                        "occurrences": sum(len(row["occurrences"]) for row in warnings)}}


def _is_verified_cue(occurrence: Mapping[str, Any]) -> bool:
    return (occurrence.get("kind") == "stage-direction"
            and occurrence.get("cueVerification") == "verified")


def _verified_script_occurrences(blocks, dialogue, result):
    """Admit only exact eligible anchors from the dedicated conservative classifier."""
    from .script_cues import script_cue_candidates

    if not isinstance(result, Mapping):
        raise ReviewContractError("Script directions result must be an object")
    proposals = result.get("occurrences", [])
    if not proposals:
        return []
    candidates = {
        (row["blockId"], row["sourceStart"], row["sourceEnd"], row["source"])
        for row in script_cue_candidates({"blocks": blocks}, dialogue)
    }
    by_id = {str(block["id"]): block for block in blocks}
    rows = []
    seen = set()
    for proposal in proposals:
        if not isinstance(proposal, Mapping):
            raise ReviewContractError("Script direction proposal must be an object")
        start, end = proposal.get("sourceStart"), proposal.get("sourceEnd")
        if (type(start) is not int or type(end) is not int
                or not isinstance(proposal.get("source"), str)):
            raise ReviewContractError("Script direction proposal has an invalid source range")
        anchor = (str(proposal.get("blockId", "")), start, end, proposal["source"])
        if (anchor not in candidates or anchor in seen
                or proposal.get("recommendedAction") != "exclude"
                or proposal.get("policy") != "decisions-luna-script-directions-v1"
                or proposal.get("model") != "gpt-6-luna"):
            raise ReviewContractError("Script direction proposal does not match verified eligible source")
        seen.add(anchor)
        block = by_id[anchor[0]]
        row = _occurrence("stage-direction", anchor[0], start, end, anchor[3],
                          int(block["page"]),
                          "AI checks agree this is a delivery instruction. Leave it unspoken or keep the original text.",
                          block_text=block["text"])
        row.update(cueVerification="verified", recommendedAction="exclude",
                   policy=proposal["policy"], model=proposal["model"],
                   availableActions=["keep", "exclude"])
        # Identical cue words are not identical evidence in different story contexts.
        row["matchKey"] = _digest([row["blockId"], start, end, row["source"]])
        rows.append(row)
    add_source_context(rows, blocks)
    return rows


def _validate_verified_cue_sources(dialogue, review, *, rendered=False):
    """Bind cue omissions to exact immutable source and to their accepted choices."""
    occurrences = {str(row["id"]): row for warning in review.get("warningSnapshot", [])
                   for row in warning.get("occurrences", [])}
    cues = {key: row for key, row in occurrences.items() if _is_verified_cue(row)}
    if not cues:
        return
    choices = {str(row.get("occurrenceId")): str(row.get("action"))
               for row in review.get("decisions", [])}
    spans = list(dialogue.get("spans", []))
    for key, cue in cues.items():
        start, end = cue["sourceStart"], cue["sourceEnd"]
        owners = sorted((span for span in spans if span.get("blockId") == cue["blockId"]
                         and max(start, int(span["sourceStart"])) < min(end, int(span["sourceEnd"]))),
                        key=lambda span: int(span["sourceStart"]))
        cursor, pieces = start, []
        for span in owners:
            left, right = max(start, int(span["sourceStart"])), min(end, int(span["sourceEnd"]))
            if left != cursor:
                raise ReviewContractError("Script direction no longer has exact source coverage")
            pieces.append(str(span.get("source", ""))[left - int(span["sourceStart"]):right - int(span["sourceStart"])])
            cursor = right
            if rendered:
                # Other explicit, narrower source policies retain their established precedence.
                policies = [(row["sourceEnd"] - row["sourceStart"], choices[other_key])
                            for other_key, row in occurrences.items()
                            if choices.get(other_key) in {"exclude", "narrate"}
                            and row.get("blockId") == cue["blockId"]
                            and row["sourceStart"] <= left < right <= row["sourceEnd"]]
                expected = min(policies)[1] if policies else "keep"
                actual = span.get("reviewAction", "keep")
                # A spelling repair marks its whole owning span, including retained
                # cues outside the edited range. The repair IDs and exact resulting
                # text are independently checked by review_source_validation_view.
                if actual == "repair" and expected == "keep" and span.get("reviewRepairs"):
                    actual = "keep"
                if actual != expected:
                    raise ReviewContractError("Rendered script direction differs from its accepted choice")
        if cursor != end or "".join(pieces) != cue.get("source"):
            raise ReviewContractError("Script direction no longer matches its exact source")
    if rendered:
        for span in spans:
            key = str(span.get("reviewOccurrenceId"))
            if key not in cues:
                continue
            cue = cues[key]
            if (choices.get(key) != "exclude" or span.get("reviewAction") != "exclude"
                    or span.get("blockId") != cue["blockId"]
                    or not cue["sourceStart"] <= int(span["sourceStart"]) < int(span["sourceEnd"]) <= cue["sourceEnd"]):
                raise ReviewContractError("Rendered script direction omission exceeds its accepted source")


def _project_cleanup_anchor(
    proposal: Mapping[str, Any],
    existing: Sequence[tuple[dict[str, Any], dict[str, Any]]],
) -> list[tuple[dict[str, Any], dict[str, Any], str | None]]:
    """Remove unchanged disambiguating context around one known deterministic issue.

    Do not trim a replacement to its minimal character difference: that would turn a whole-word
    source anchor into a deletion of a hyphen. Preserve the deterministic evidence range instead.
    """
    replacement = proposal.get("replacement")
    if replacement is None:
        # An unrepairable subrange is additional evidence for the containing source warning,
        # not a second cleanup decision. A unique owner is still required by the caller.
        return [(warning, occurrence, None) for warning, occurrence in existing
                if occurrence.get("blockId") == proposal["blockId"]
                and occurrence["sourceStart"] <= proposal["sourceStart"]
                < proposal["sourceEnd"] <= occurrence["sourceEnd"]]
    if not isinstance(replacement, str):
        return []
    result = []
    for warning, occurrence in existing:
        if (occurrence.get("blockId") != proposal["blockId"]
                or not proposal["sourceStart"] <= occurrence["sourceStart"]
                < occurrence["sourceEnd"] <= proposal["sourceEnd"]):
            continue
        left = occurrence["sourceStart"] - proposal["sourceStart"]
        right = occurrence["sourceEnd"] - proposal["sourceStart"]
        prefix, suffix = proposal["source"][:left], proposal["source"][right:]
        if (len(replacement) < len(prefix) + len(suffix)
                or not replacement.startswith(prefix) or not replacement.endswith(suffix)):
            continue
        middle = replacement[len(prefix):len(replacement) - len(suffix) if suffix else None]
        if middle != occurrence["source"]:
            result.append((warning, occurrence, middle))
    return result


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

    for key, occurrence in occurrence_index.items():
        if key not in accepted and _is_verified_cue(occurrence):
            accepted[key] = {"occurrenceId": key, "warningId": occurrence["warningId"],
                             "action": "keep", "consequence": _consequence("keep", 1),
                             "provenance": "preserve-undecided-script-direction"}
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
        "cleanupSummary": dict(workspace.get("cleanupSummary", {})),
        "unifiedSuggestions": workspace.get("unifiedSuggestions") is True,
        "hyphenReviewEvidence": deepcopy(workspace.get("hyphenReviewEvidence")),
        "focusedReviewEvidence": deepcopy(workspace.get("focusedReviewEvidence")),
        "chapterReviewEvidence": deepcopy(workspace.get("chapterReviewEvidence")),
        "cleanupPatternEvidence": deepcopy(workspace.get("cleanupPatternEvidence", {"groups": [], "windows": []})),
        "scriptDirectionsSummary": dict(workspace.get("scriptDirectionsSummary", {})),
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
    _validate_verified_cue_sources(dialogue, review)
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
    return {**dict(dialogue), "spans": _apply_cleanup_repairs(result, review)}


def _repair_text(span: Mapping[str, Any], edits: Sequence[Mapping[str, Any]]) -> str:
    start = int(span.get("sourceStart", 0))
    source = str(span.get("source", ""))
    spoken_start = int(span.get("spokenStart", start))
    spoken_end = int(span.get("spokenEnd", span.get("sourceEnd", start + len(source))))
    text = source[spoken_start - start:spoken_end - start]
    last = spoken_end
    for edit in sorted(edits, key=lambda row: row["sourceStart"], reverse=True):
        left, right = int(edit["sourceStart"]), int(edit["sourceEnd"])
        if (span.get("blockId") != edit.get("blockId")
                or not spoken_start <= left < right <= last
                or source[left - start:right - start] != edit.get("source")
                or not isinstance(edit.get("replacement"), str)):
            raise ReviewContractError("Cleanup repair no longer matches its spoken source range")
        text = text[:left - spoken_start] + edit["replacement"] + text[right - spoken_start:]
        last = left
    return text


def _hyphen_choices(source: str) -> dict[str, str]:
    if _LINE_HYPHEN.fullmatch(source) is None:
        raise ReviewContractError("Hyphen choice requires an exact line-wrapped word")
    left, right = re.split(r"[-\u00ad][ \t\r]*\n[ \t]*", source)
    return {"keep-hyphen": left + "-" + right, "join-word": left + right}


def _accepted_repairs(review: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    occurrences = {str(row["id"]): row for warning in review.get("warningSnapshot", [])
                   for row in warning.get("occurrences", [])}
    result = {}
    for decision in review.get("decisions", []):
        action = decision.get("action")
        if action not in {"repair", "keep-hyphen", "join-word"}:
            continue
        key = str(decision["occurrenceId"])
        row = occurrences.get(key)
        if action in {"keep-hyphen", "join-word"}:
            if (row is None or row.get("kind") != "hyphenation"
                    or action not in row.get("availableActions", [])
                    or row.get("hyphenChoices") != _hyphen_choices(row["source"])):
                raise ReviewContractError("Hyphen choice requires durable source evidence")
            result[key] = {**row, "replacement": row["hyphenChoices"][action]}
            continue
        if (row is None or row.get("proposalStatus") != "proposed"
                or "repair" not in row.get("availableActions", [])
                or not isinstance(row.get("replacement"), str)):
            raise ReviewContractError("Repair requires a durable cleanup proposal")
        result[key] = row
    return result


def _apply_cleanup_repairs(
    spans: Sequence[Mapping[str, Any]], review: Mapping[str, Any],
) -> list[dict[str, Any]]:
    edits = _accepted_repairs(review)
    assigned: dict[int, list[Mapping[str, Any]]] = defaultdict(list)
    for key, edit in edits.items():
        overlaps = [(index, span) for index, span in enumerate(spans)
                    if span.get("blockId") == edit.get("blockId")
                    and max(int(span["sourceStart"]), int(edit["sourceStart"]))
                    < min(int(span["sourceEnd"]), int(edit["sourceEnd"]))]
        if overlaps and all(span.get("reviewAction") == "exclude" for _, span in overlaps):
            # An explicit removal makes a proposed spelling fix irrelevant to narration.
            continue
        if len(overlaps) != 1:
            raise ReviewContractError("Cleanup repair crosses another review decision; keep it or revise that decision")
        index, span = overlaps[0]
        _repair_text(span, [edit])
        assigned[index].append({**edit, "id": key})
    result = []
    for index, raw in enumerate(spans):
        span = dict(raw)
        if index in assigned:
            span["text"] = _repair_text(span, assigned[index])
            span["reviewRepairs"] = [row["id"] for row in assigned[index]]
            span["reviewAction"] = "repair" if span["text"].strip() else "exclude"
            span["reviewRevision"] = review.get("revision")
            if span["reviewAction"] == "exclude":
                span["renderRole"] = "narration"
            span["origin"] = "review:repair"
        result.append(span)
    return result


def review_source_validation_view(
    dialogue: Mapping[str, Any], review: Mapping[str, Any],
) -> dict[str, Any]:
    """Verify accepted replacements, then expose original playable text to source validators."""
    _validate_verified_cue_sources(dialogue, review, rendered=True)
    edits = _accepted_repairs(review)
    spans = []
    seen: set[str] = set()
    for raw in dialogue.get("spans", []):
        span = dict(raw)
        ids = span.get("reviewRepairs", [])
        if ids:
            if (span.get("reviewRevision") != review.get("revision")
                    or any(key not in edits or key in seen for key in ids)):
                raise ReviewContractError("Rendered cleanup is not bound to the accepted review")
            if _repair_text(span, [edits[key] for key in ids]) != span.get("text"):
                raise ReviewContractError("Rendered cleanup differs from its accepted proposal")
            seen.update(ids)
            start = int(span.get("sourceStart", 0))
            left = int(span.get("spokenStart", start)) - start
            right = int(span.get("spokenEnd", span["sourceEnd"])) - start
            span["text"] = str(span["source"])[left:right]
        spans.append(span)
    # Accepted edits cannot disappear merely because a renderer omitted their metadata.
    # Only an explicit source exclusion can make a repair irrelevant to narration.
    occurrences = {str(row["id"]): row for warning in review.get("warningSnapshot", [])
                   for row in warning.get("occurrences", [])}
    excluded = [occurrences[str(row["occurrenceId"])] for row in review.get("decisions", [])
                if row.get("action") == "exclude" and str(row.get("occurrenceId")) in occurrences]
    for key in set(edits) - seen:
        edit = edits[key]
        cursor = int(edit["sourceStart"])
        for row in sorted(excluded, key=lambda row: row["sourceStart"]):
            if row.get("blockId") == edit.get("blockId") and int(row["sourceStart"]) <= cursor:
                cursor = max(cursor, int(row["sourceEnd"]))
        owners = [span for span in spans if span.get("blockId") == edit.get("blockId")
                  and max(int(span["sourceStart"]), int(edit["sourceStart"]))
                  < min(int(span["sourceEnd"]), int(edit["sourceEnd"]))]
        if (cursor < int(edit["sourceEnd"]) or not owners
                or any(span.get("reviewAction") != "exclude" for span in owners)):
            raise ReviewContractError("Accepted cleanup repair is missing from the rendered transcript")
    return {**dict(dialogue), "spans": spans}


def preview_review_transcript_page(
    extraction: Mapping[str, Any],
    dialogue: Mapping[str, Any],
    workspace: Mapping[str, Any],
    policies: Sequence[Mapping[str, Any]],
    *,
    page: int,
    page_count: int | None = None,
    occurrence_policies: Sequence[Mapping[str, Any]] = (),
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
        if warning.get("decisionScope") == "occurrence" or warning.get("kind") == "ai-cleanup":
            raise ReviewContractError("Occurrence-scoped warnings require individual preview policies")
        for occurrence in warning.get("occurrences", []):
            _validate_action(occurrence, action)
        chosen[warning_id] = action

    occurrence_groups = {key for key, warning in warnings.items()
                         if warning.get("decisionScope") == "occurrence"
                         or warning.get("kind") == "ai-cleanup"}
    ai_occurrences = {str(row["id"]): row for key in occurrence_groups
                      for row in warnings[key].get("occurrences", [])}
    ai_chosen: dict[str, str] = {}
    for policy in occurrence_policies:
        key = str(policy.get("occurrenceId", ""))
        if key not in ai_occurrences or key in ai_chosen:
            raise ReviewContractError("Cleanup preview requires unique known occurrence IDs")
        action = str(policy.get("action", ""))
        _validate_action(ai_occurrences[key], action)
        ai_chosen[key] = action
    for key, occurrence in ai_occurrences.items():
        if key not in ai_chosen and _is_verified_cue(occurrence):
            ai_chosen[key] = "keep"
    if set(ai_chosen) != set(ai_occurrences):
        raise ReviewContractError("Every cleanup proposal must be decided before preview")
    missing = sorted(key for key in warnings if key not in chosen and key not in occurrence_groups)
    if missing:
        raise ReviewContractError(
            "Every Review warning group must be decided before previewing the final transcript"
        )

    decisions = [
        {"occurrenceId": str(occurrence["id"]), "action": chosen[warning_id]}
        for warning_id, warning in warnings.items()
        if warning_id not in occurrence_groups
        for occurrence in warning.get("occurrences", [])
    ] + [{"occurrenceId": key, "action": action} for key, action in ai_chosen.items()]
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


def _text_occurrences(
    blocks: Sequence[Mapping[str, Any]], spans: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    # Repeated numbered footer evidence makes an isolated top numeral ambiguous
    # (often a chapter-local counter). Preserve it without a second folio warning.
    numbered_pages = {row["page"] for row in numbered_edge_candidates(blocks)}
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
        for match in _LINE_HYPHEN.finditer(text):
            occurrence = _from_match(
                "hyphenation", block, match,
                "Possible line-wrapped word. Check the source before joining: a genuine "
                "compound or interrupted speech must retain its hyphen. Do not exclude the word.",
            )
            occurrence["detectionRule"] = "line-wrap-hyphen"
            # A repair must fit one spoken span so neither reader nor source ownership changes.
            if any(str(span.get("blockId")) == block_id
                   and int(span.get("spokenStart", span.get("sourceStart", 0))) <= match.start()
                   and match.end() <= int(span.get("spokenEnd", span.get("sourceEnd", 0)))
                   for span in spans):
                occurrence["hyphenChoices"] = _hyphen_choices(match.group())
                result.append(occurrence)
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
            if (
                is_edge and _PAGE_NUMBER.fullmatch(stripped)
                and not (is_first_block and line_index < 2 and int(block["page"]) in numbered_pages)
            ):
                result.append(
                    _from_match("page-number", block, match, "Page-number-shaped edge line.")
                )
            if is_edge and len(stripped) >= 3 and not _PAGE_NUMBER.fullmatch(stripped):
                edge_lines[" ".join(stripped.casefold().split())].append(
                    (block, match.start(), match.end(), value)
                )

    for rows in edge_lines.values():
        if len({int(row[0]["page"]) for row in rows}) < 2:
            continue
        repeated_top_title = _looks_like_running_title(rows[0][3]) and all(
            row[1] == 0 for row in rows
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


def numbered_edge_candidates(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return exact model candidates from repeated last-line labels and changing folios.

    This language-neutral structural signal is not proof of a publisher/footer role.
    Three distinct pages must share a label and folio offset. Candidates remain
    model evidence only and never create deterministic review items or omissions.
    This pure helper also supports candidate-recall benchmarks without model calls.
    """
    pages: dict[int, list[tuple[Mapping[str, Any], re.Match[str]]]] = defaultdict(list)
    for block in blocks:
        pages[int(block["page"])].extend(
            (block, match) for match in re.finditer(r"[^\n]+", str(block["text"]))
            if match.group().strip()
        )
    candidates: dict[tuple[str, int], list[tuple[Mapping[str, Any], re.Match[str]]]] = defaultdict(list)
    for page, lines in pages.items():
        if not lines:
            continue
        # A numbered publisher footer is a stronger signal than an isolated
        # numeral at the top of a page (often a chapter/section number).
        block, match = lines[-1]
        label = re.fullmatch(r"\s*(?P<label>[^\d\n]{3,60}?)\s*(?P<number>\d{1,4})\s*", match.group())
        if label is None:
            continue
        name = label["label"].strip()
        if not any(char.isalpha() for char in name) or any(
            not (char.isalpha() or char.isspace() or char in "-–—&") for char in name
        ):
            continue
        key = (" ".join(name.casefold().split()), int(label["number"]) - page)
        candidates[key].append((block, match))
    result = []
    for (label_key, folio_offset), rows in candidates.items():
        repeated_pages = sorted({int(block["page"]) for block, _ in rows})
        if len(repeated_pages) < 3:
            continue
        for block, match in rows:
            occurrence = _from_match(
                "page-number", block, match,
                "Last-line label repeats on at least three pages with a consistent folio offset; verify its role.",
            )
            occurrence["detectionRule"] = "repeated-numbered-edge"
            occurrence["patternGroupId"] = "numbered-edge:" + _digest([label_key, folio_offset])
            occurrence["patternEvidence"] = {
                "distinctPageCount": len(repeated_pages), "folioOffset": folio_offset,
                "firstPage": repeated_pages[0], "lastPage": repeated_pages[-1],
            }
            result.append(occurrence)
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
            if not _is_footnote_marker(stripped) or (
                not section_active and not re.match(r"^\s*(?:\[\d{1,3}\]|[*†‡])", stripped)
            ):
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
    from .chapters import is_chapter_heading_hint
    without_number = re.sub(r"^\s*\d{1,3}[.)]\s+", "", value)
    return bool(_FOOTNOTE.match(value) and not is_chapter_heading_hint(without_number))


def _is_note_section_boundary(value: str) -> bool:
    from .chapters import is_chapter_heading_hint
    # A short standalone label ends a note, regardless of its language or wording.
    # Prefer leaving a continuation ungrouped over extending a note into new content.
    return is_chapter_heading_hint(value) or bool(re.fullmatch(r"\s*[^\n.!?。！？:：]{1,80}[:：]\s*", value))


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
    if re.search(r":\s*\[", stripped) or stripped.startswith(('"', "'", "“", "‘", "「", "『")):
        return False
    if re.search(r"https?://|www\.|@\w", folded):
        return True
    return False


def _looks_like_running_title(value: str) -> bool:
    """Require a short title-shaped line, not just repeated first-page prose."""
    stripped = value.strip()
    if not 12 <= len(stripped) <= 100 or re.search(r'[\[\]"“”「」『』:!?.,;]', stripped):
        return False
    words = stripped.split()
    return 2 <= len(words) <= 10 and sum(word[:1].isupper() for word in words) / len(words) >= 0.5


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
        elif kind == "ai-cleanup":
            by_pattern: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for occurrence in occurrences:
                by_pattern[str(occurrence.get("patternGroupId", ""))].append(occurrence)
            evidence_groups = list(by_pattern.values())
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
                if kind != "ai-cleanup" and not _is_verified_cue(occurrence):
                    occurrence["availableActions"] = list(available_actions)
            if kind == "stage-direction" and all(_is_verified_cue(row) for row in evidence_group):
                available_actions = ["keep", "exclude"]
            suffix = (
                f":{evidence_group[0]['matchKey']}"
                if kind == "repeated-matter"
                else f":{evidence_group[0]['patternGroupId']}"
                if kind == "ai-cleanup" and evidence_group[0].get("patternGroupId")
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
                        "occurrence" if kind in {"ai-cleanup", "hyphenation"} or all(_is_verified_cue(row) for row in evidence_group) else
                        "identical-evidence"
                        if kind == "repeated-matter"
                        else "warning-kind"
                    ),
                    "bulkScope": "identical-evidence",
                    "availableActions": available_actions,
                    "readerState": reader_state,
                    "occurrences": evidence_group,
                    **({"patternGroupId": evidence_group[0]["patternGroupId"],
                        "patternVerification": "verified"}
                       if kind == "ai-cleanup" and evidence_group[0].get("patternGroupId") else {}),
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
            else "corrected"
            if action in {"repair", "keep-hyphen", "join-word"}
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
            if action in {"exclude", "narrate", "repair", "keep-hyphen", "join-word"}
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
