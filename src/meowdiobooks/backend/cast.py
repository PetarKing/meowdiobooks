"""Pure contracts for Cast identity evidence and reconciliation.

This module intentionally performs no model or audio calls.  Dialogue owns literal
speaker extraction; Cast turns those labels into evidence-rich, reviewable identity
proposals and, only after review, durable character mappings.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from difflib import SequenceMatcher
from hashlib import sha256
import json
import re
import unicodedata
from typing import Any


IDENTITY_CATEGORIES = frozenset({"character", "group", "editorial", "unresolved-marker"})
REVIEW_IDENTITY_CATEGORIES = IDENTITY_CATEGORIES | {"narrator"}
PLAYABLE_CATEGORIES = frozenset({"character", "group"})


class CastContractError(ValueError):
    """Raised when a Cast proposal cannot safely become reviewable state."""


def normalize_label(label: object) -> str:
    """Return the display-preserving Unicode normalization used by Cast."""
    if label is None:
        return ""
    return " ".join(unicodedata.normalize("NFC", str(label)).strip().split())


def label_comparison_key(label: object) -> str:
    """Return a comparison key; source spellings are still preserved separately."""
    value = unicodedata.normalize("NFKC", normalize_label(label)).casefold()
    return " ".join(value.split())


def stable_character_id(canonical_name: object, category: str = "character") -> str:
    """Build an opaque ID stable across ordering, batching and display changes."""
    name = normalize_label(canonical_name)
    if category not in PLAYABLE_CATEGORIES or not name:
        raise CastContractError("Stable IDs require a named playable identity")
    digest = sha256(f"{category}\0{label_comparison_key(name)}".encode()).hexdigest()[:20]
    return f"{category}-{digest}"


def build_label_dossiers(
    turns: Sequence[Mapping[str, Any]], *, min_examples: int = 2, max_examples: int = 4
) -> list[dict[str, Any]]:
    """Build deterministic evidence dossiers for every resolved literal source label.

    Input ordering is treated as source ordering.  A label's first spelling is its
    display spelling; case or compatibility-normalized variants remain visible in
    ``sourceSpellings`` rather than being silently rewritten.
    """
    if not 1 <= min_examples <= max_examples:
        raise CastContractError("Example limits must satisfy 1 <= min <= max")

    grouped: dict[str, list[tuple[int, Mapping[str, Any]]]] = defaultdict(list)
    spellings: dict[str, list[str]] = defaultdict(list)
    for order, turn in enumerate(turns):
        raw_label = _literal_label(turn)
        if raw_label is None or _is_unresolved(turn):
            continue
        label = normalize_label(raw_label)
        if not label:
            continue
        key = label_comparison_key(label)
        grouped[key].append((order, turn))
        if label not in spellings[key]:
            spellings[key].append(label)

    dossiers: list[dict[str, Any]] = []
    for key, occurrences in grouped.items():
        first_order, first = occurrences[0]
        selected = _representative_occurrences(occurrences, min_examples, max_examples)
        dossiers.append(
            {
                "label": spellings[key][0],
                "normalizedKey": key,
                "sourceSpellings": spellings[key],
                "occurrenceCount": len(occurrences),
                "firstAppearance": _appearance(first, first_order),
                "examples": [
                    _context_example(turn, order, turns) for order, turn in selected
                ],
            }
        )
    dossiers.sort(
        key=lambda row: (
            int(row["firstAppearance"]["sourceOrder"]),
            label_comparison_key(row["label"]),
        )
    )
    return dossiers


def suggest_fuzzy_candidates(
    dossiers: Sequence[Mapping[str, Any]], *, threshold: float = 0.86
) -> list[dict[str, Any]]:
    """Suggest conservative review candidates without merging any identities."""
    if not 0.0 <= threshold <= 1.0:
        raise CastContractError("Fuzzy threshold must be between zero and one")
    suggestions: list[dict[str, Any]] = []
    ordered = sorted(dossiers, key=lambda row: label_comparison_key(row.get("label", "")))
    for index, left in enumerate(ordered):
        left_label = normalize_label(left.get("label", ""))
        left_key = _fuzzy_key(left_label)
        for right in ordered[index + 1 :]:
            right_label = normalize_label(right.get("label", ""))
            right_key = _fuzzy_key(right_label)
            if not left_key or not right_key or min(len(left_key), len(right_key)) < 4:
                continue
            # A joint-delivery label is not an alias for either individual member.
            if looks_joint_label(left_label) != looks_joint_label(right_label):
                continue
            score = SequenceMatcher(None, left_key, right_key).ratio()
            token_containment = _token_containment(left_key, right_key)
            single_edit_typo = min(
                len(left_key), len(right_key)
            ) >= 5 and _edit_distance_at_most_one(left_key, right_key)
            # Containment is useful for honorific/full-name variants, but only when
            # the shared material is substantial enough to avoid "Ann"/"Anna" noise.
            if score < threshold and not token_containment and not single_edit_typo:
                continue
            suggestions.append(
                {
                    "leftLabel": left_label,
                    "rightLabel": right_label,
                    "score": round(score, 4),
                    "reason": (
                        "substantial-token-containment"
                        if token_containment
                        else "single-edit-typo"
                        if single_edit_typo
                        else "fuzzy-name"
                    ),
                    "automaticMerge": False,
                }
            )
    return suggestions


def build_compact_label_ledger(dossiers: Sequence[Mapping[str, Any]]) -> str:
    """Build the complete, deterministic ledger included with every Qwen batch."""
    rows = []
    for dossier in sorted(
        dossiers,
        key=lambda row: (
            -int(row.get("occurrenceCount", 0)),
            int((row.get("firstAppearance") or {}).get("sourceOrder", 0)),
            label_comparison_key(row.get("label", "")),
        ),
    ):
        label = normalize_label(dossier.get("label", ""))
        if not label or any(character in label for character in "\t\r\n"):
            raise CastContractError("Ledger labels must be non-empty single-line strings")
        rows.append(
            f"{label}\t{int(dossier.get('occurrenceCount', 0))}"
            f"\tfirst:{int((dossier.get('firstAppearance') or {}).get('sourceOrder', 0))}"
        )
    return "\n".join(rows)


def validate_identity_proposals(
    proposals: Sequence[Mapping[str, Any]],
    expected_labels: Iterable[str],
    *,
    known_labels: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Validate one complete proposal set without accepting any material merge.

    ``expected_labels`` are the dossiers owned by this batch. ``known_labels`` may
    include the complete global ledger, allowing a batch to refer to a candidate
    identity which is owned by another batch without inventing a source label.
    """
    expected = {label_comparison_key(label): normalize_label(label) for label in expected_labels}
    known = {
        label_comparison_key(label): normalize_label(label)
        for label in (known_labels if known_labels is not None else expected_labels)
    }
    if not set(expected).issubset(known):
        raise CastContractError("Every expected label must exist in the known global ledger")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in proposals:
        label = normalize_label(raw.get("label", ""))
        key = label_comparison_key(label)
        if key not in expected:
            raise CastContractError(f"Proposal references unknown label: {label or '<empty>'}")
        if key in seen:
            raise CastContractError(f"Duplicate identity proposal for {expected[key]}")
        seen.add(key)

        category = str(raw.get("category", "")).strip()
        if category not in IDENTITY_CATEGORIES:
            raise CastContractError(f"Unsupported identity category for {label}: {category}")
        canonical = normalize_label(raw.get("canonicalName", "")) or None
        if category in PLAYABLE_CATEGORIES and canonical is None:
            raise CastContractError(f"Playable identity {label} requires canonicalName")
        if category not in PLAYABLE_CATEGORIES and canonical is not None:
            raise CastContractError(f"Non-playable identity {label} cannot have canonicalName")

        aliases = _clean_label_list(raw.get("aliases", []), "aliases")
        competitors = _clean_label_list(raw.get("competingLabels", []), "competingLabels")
        unknown_aliases = [value for value in aliases if label_comparison_key(value) not in known]
        if unknown_aliases:
            raise CastContractError(f"Proposal for {label} has unknown aliases: {unknown_aliases}")
        unknown_competitors = [
            value for value in competitors if label_comparison_key(value) not in known
        ]
        if unknown_competitors:
            raise CastContractError(
                f"Proposal for {label} has unknown competing labels: {unknown_competitors}"
            )
        reason = normalize_label(raw.get("reason", ""))
        if not reason:
            raise CastContractError(f"Proposal for {label} requires evidence-grounded reason")

        material = (
            category != "character"
            or bool(aliases)
            or bool(competitors)
            or (canonical is not None and label_comparison_key(canonical) != key)
        )
        validated.append(
            {
                "label": expected[key],
                "category": category,
                "canonicalName": canonical,
                "aliases": aliases,
                "competingLabels": competitors,
                "reason": reason,
                "voiceProfile": normalize_label(raw.get("voiceProfile", "")) or None,
                "auditionLine": normalize_label(raw.get("auditionLine", "")) or None,
                # The model may flag more items, but cannot clear deterministic material risk.
                "reviewRequired": material or raw.get("reviewRequired") is True,
            }
        )
    missing = [expected[key] for key in expected.keys() - seen]
    if missing:
        raise CastContractError(f"Missing identity proposals: {sorted(missing)}")
    return sorted(validated, key=lambda row: label_comparison_key(row["label"]))


def build_relationship_summary(
    proposal_batches: Sequence[Sequence[Mapping[str, Any]]],
    dossiers: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Build deterministic relationship conflicts from validated proposals."""
    flattened = [dict(proposal) for batch in proposal_batches for proposal in batch]
    by_canonical: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for proposal in flattened:
        by_label[label_comparison_key(proposal.get("label", ""))].append(proposal)
        canonical = proposal.get("canonicalName")
        if canonical:
            by_canonical[label_comparison_key(canonical)].append(proposal)

    conflicts: list[dict[str, Any]] = []
    for rows in by_label.values():
        signatures = {
            (row.get("category"), label_comparison_key(row.get("canonicalName", "")))
            for row in rows
        }
        if len(signatures) > 1:
            conflicts.append({"kind": "label-conflict", "proposals": rows})
    for rows in by_canonical.values():
        categories = {row.get("category") for row in rows}
        if len(rows) > 1 or len(categories) > 1:
            conflicts.append({"kind": "cross-label-group", "proposals": rows})
    conflicts.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
    return {
        "globalLabelLedger": build_compact_label_ledger(dossiers),
        "proposals": flattened,
        "conflicts": conflicts,
    }


def finalize_identity_mapping(
    proposals: Sequence[Mapping[str, Any]],
    review_decisions: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Apply explicit review decisions and produce durable playable identities.

    Any flagged proposal lacking a decision blocks finalization.  A decision replaces
    category/canonicalName only; the literal source label and evidence remain intact.
    """
    decisions = {
        label_comparison_key(key): value for key, value in (review_decisions or {}).items()
    }
    effective: list[dict[str, Any]] = []
    review_receipt: list[dict[str, Any]] = []
    for proposal in proposals:
        row = dict(proposal)
        key = label_comparison_key(row.get("label", ""))
        decision = decisions.get(key)
        if row.get("reviewRequired") and decision is None:
            raise CastContractError(
                f"Resolve flagged identity before auditions: {row.get('label')}"
            )
        if decision is not None:
            category = str(decision.get("category", row.get("category", ""))).strip()
            canonical = (
                normalize_label(decision.get("canonicalName", row.get("canonicalName", ""))) or None
            )
            if category not in REVIEW_IDENTITY_CATEGORIES:
                raise CastContractError(f"Unsupported reviewed category: {category}")
            if (category in PLAYABLE_CATEGORIES) != (canonical is not None):
                raise CastContractError("Reviewed playable identities require a canonical name")
            row.update({"category": category, "canonicalName": canonical, "reviewRequired": False})
            reviewed_aliases = _clean_label_list(
                decision.get("aliases", row.get("aliases", [])), "aliases"
            )
            row["aliases"] = reviewed_aliases
            review_receipt.append(
                {
                    "label": normalize_label(row.get("label", "")),
                    "category": category,
                    "canonicalName": canonical,
                    "aliases": reviewed_aliases,
                }
            )
        effective.append(row)

    identities: dict[tuple[str, str], dict[str, Any]] = {}
    label_mapping: dict[str, str | None] = {}
    for row in effective:
        label = normalize_label(row.get("label", ""))
        literal_spellings = _clean_source_spellings(
            [label, *row.get("sourceSpellings", []), *row.get("aliases", [])],
        )
        category = str(row.get("category", ""))
        canonical = row.get("canonicalName")
        if category not in PLAYABLE_CATEGORIES:
            for spelling in literal_spellings:
                _set_label_mapping(label_mapping, spelling, None)
            continue
        identity_key = (category, label_comparison_key(canonical))
        identity = identities.setdefault(
            identity_key,
            {
                "characterId": stable_character_id(canonical, category),
                "name": normalize_label(canonical),
                "category": category,
                "literalLabels": [],
                "voiceProfile": row.get("voiceProfile"),
                "auditionLine": row.get("auditionLine"),
                "voiceAccepted": False,
            },
        )
        identity["literalLabels"].extend(literal_spellings)
        for spelling in literal_spellings:
            _set_label_mapping(label_mapping, spelling, identity["characterId"])
    result = sorted(
        identities.values(), key=lambda row: (row["category"], label_comparison_key(row["name"]))
    )
    for identity in result:
        identity["literalLabels"] = sorted(
            set(identity["literalLabels"]),
            key=lambda value: (label_comparison_key(value), value),
        )
    return {
        "identities": result,
        "labelToCharacterId": label_mapping,
        "identityReviewDecisions": review_receipt,
    }


def _set_label_mapping(
    mapping: dict[str, str | None], label: str, character_id: str | None
) -> None:
    existing = mapping.get(label)
    if label in mapping and existing != character_id:
        raise CastContractError(f"Literal label maps to conflicting identities: {label}")
    mapping[label] = character_id


def _clean_source_spellings(value: object) -> list[str]:
    if not isinstance(value, list):
        raise CastContractError("source spellings must be a list")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        label = normalize_label(item)
        if label and label not in seen:
            seen.add(label)
            result.append(label)
    return result


def cast_progression_blockers(cast_revision: Mapping[str, Any]) -> list[str]:
    """Return deterministic reasons Cast cannot advance to Enrichment or Generate."""
    blockers = []
    identities = [row for row in cast_revision.get("identities", []) if isinstance(row, Mapping)]
    by_id = {str(row.get("characterId", "")): row for row in identities}
    for identity in identities:
        route = identity.get("voiceRoute")
        if isinstance(route, Mapping) and str(route.get("kind", "")) == "layered":
            member_ids = [str(value) for value in route.get("characterIds", []) if str(value)]
            members_ready = (
                len(member_ids) >= 2
                and len(set(member_ids)) == len(member_ids)
                and all(
                    (member := by_id.get(member_id)) is not None
                    and member.get("category") == "character"
                    and member.get("voiceAccepted")
                    for member_id in member_ids
                )
            )
            if not identity.get("voiceAccepted") or not members_ready:
                blockers.append(
                    f"Complete the layered voice route for {identity.get('name', 'unnamed group')}"
                )
            continue
        if not identity.get("voiceAccepted"):
            blockers.append(f"Accept one audition for {identity.get('name', 'unnamed identity')}")
    return blockers


def _literal_label(turn: Mapping[str, Any]) -> object | None:
    if str(turn.get("speakerStatus", "")).strip().casefold() in {"ai", "user"} and turn.get(
        "resolvedSpeakerLabel"
    ):
        return turn["resolvedSpeakerLabel"]
    for field in ("sourceSpeakerLabel", "literalSpeakerLabel", "speakerLabel", "speaker"):
        if field in turn and turn[field] is not None:
            return turn[field]
    return None


def _is_unresolved(turn: Mapping[str, Any]) -> bool:
    return str(turn.get("speakerStatus", "")).strip().casefold() in {
        "unresolved",
        "open-marker",
        "not-applicable",
    }


def _appearance(turn: Mapping[str, Any], order: int) -> dict[str, Any]:
    appearance = {
        "sourceOrder": order,
        "spanId": str(
            turn.get("spanId") or turn.get("turnId") or turn.get("id") or f"turn-{order}"
        ),
    }
    for field in ("chapter", "chapterId", "page", "blockId"):
        if turn.get(field) is not None:
            appearance[field] = turn[field]
    return appearance


def _context_example(
    turn: Mapping[str, Any],
    order: int,
    turns: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    example = _appearance(turn, order)
    context_before = _clean_identity_evidence(turn.get("contextBefore"))
    context_after = _clean_identity_evidence(turn.get("contextAfter"))
    if not context_before:
        context_before = _adjacent_narration(turns, order, step=-1)
    if not context_after:
        context_after = _adjacent_narration(turns, order, step=1)
    example.update(
        {
            "sourceText": _clean_identity_evidence(
                turn.get("sourceText") or turn.get("source") or turn.get("text")
            ),
            "contextBefore": context_before,
            "contextAfter": context_after,
        }
    )
    return example


def _adjacent_narration(
    turns: Sequence[Mapping[str, Any]], order: int, *, step: int
) -> str:
    """Return the nearest local narration span without borrowing another speaker's line."""

    origin = turns[order]
    origin_chapter = origin.get("chapterId") or origin.get("chapter")
    origin_page = origin.get("page")
    index = order + step
    inspected = 0
    while 0 <= index < len(turns) and inspected < 3:
        candidate = turns[index]
        inspected += 1
        candidate_chapter = candidate.get("chapterId") or candidate.get("chapter")
        candidate_page = candidate.get("page")
        if origin_chapter is not None and candidate_chapter not in {None, origin_chapter}:
            break
        if not _pages_are_adjacent(origin_page, candidate_page):
            break
        role = str(candidate.get("renderRole", "")).strip().casefold()
        if role == "narration" or (not role and _literal_label(candidate) is None):
            text = _clean_identity_evidence(
                candidate.get("sourceText") or candidate.get("source") or candidate.get("text")
            )
            if text:
                return text
        index += step
    return ""


def _pages_are_adjacent(left: object, right: object) -> bool:
    if left is None or right is None:
        return True
    try:
        return abs(int(str(left)) - int(str(right))) <= 1
    except ValueError:
        return left == right


def _clean_identity_evidence(value: object) -> str:
    """Remove unresolved-label placeholders while preserving the source's useful words."""

    text = normalize_label(value)
    text = re.sub(r"^\?{3,}\s*[:：-]?\s*", "", text)
    text = re.sub(r"\?{3,}", "", text)
    return normalize_label(text)


def _representative_occurrences(
    occurrences: Sequence[tuple[int, Mapping[str, Any]]], min_examples: int, max_examples: int
) -> list[tuple[int, Mapping[str, Any]]]:
    wanted = min(max_examples, len(occurrences))
    if wanted <= min_examples:
        return list(occurrences[:wanted])
    # Even distribution keeps first/middle/last evidence without model-dependent sampling.
    indexes = {round(index * (len(occurrences) - 1) / (wanted - 1)) for index in range(wanted)}
    return [occurrences[index] for index in sorted(indexes)]


def _fuzzy_key(label: str) -> str:
    value = unicodedata.normalize("NFKC", label).casefold()
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _token_containment(left: str, right: str) -> bool:
    left_tokens, right_tokens = set(left.split()), set(right.split())
    common = left_tokens & right_tokens
    return (
        bool(common)
        and max(map(len, common)) >= 5
        and (common == left_tokens or common == right_tokens)
    )


def looks_joint_label(label: str) -> bool:
    return bool(re.search(r"(?:&|/|\band\b)", label, flags=re.IGNORECASE))


def _edit_distance_at_most_one(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right, strict=True)) <= 1
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    short_index = 0
    mismatches = 0
    for character in longer:
        if short_index < len(shorter) and shorter[short_index] == character:
            short_index += 1
        else:
            mismatches += 1
            if mismatches > 1:
                return False
    return True


def _clean_label_list(value: object, field: str) -> list[str]:
    if not isinstance(value, list):
        raise CastContractError(f"{field} must be a list")
    result = []
    seen = set()
    for item in value:
        label = normalize_label(item)
        key = label_comparison_key(label)
        if not label or key in seen:
            continue
        seen.add(key)
        result.append(label)
    return result
