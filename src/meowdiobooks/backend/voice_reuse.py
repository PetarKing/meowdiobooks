"""Provider-neutral cross-book casting seam and deterministic identity matching.

Compositions authorize sources and copy complete voice snapshots into the destination
before returning from apply. Preview must never perform AI work or import assets.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Protocol

from .cast import CastContractError, label_comparison_key


class CastVoiceReuse(Protocol):
    def preview(
        self,
        book_id: str,
        package: Path,
        targets: list[dict[str, Any]],
        source_book_ids: list[str],
        language: str,
        model_id: str,
    ) -> dict[str, Any]: ...

    def import_voice(
        self,
        book_id: str,
        package: Path,
        target: dict[str, Any],
        source_voice: dict[str, str],
        language: str,
        model_id: str,
    ) -> dict[str, Any]: ...

    def apply(
        self,
        book_id: str,
        package: Path,
        targets: list[dict[str, Any]],
        source_book_ids: list[str],
        language: str,
        model_id: str,
        *,
        preview_fingerprint: str | None = None,
    ) -> dict[str, dict[str, Any]]: ...


def validate_source_book_ids(values: object, destination_book_id: str) -> list[str]:
    if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
        raise CastContractError("Source books must be a list of book IDs")
    if len(values) > 100 or len(set(values)) != len(values) or destination_book_id in values:
        raise CastContractError("Select distinct source books other than this book")
    return list(values)


def _names(row: dict[str, Any]) -> set[str]:
    return {
        key
        for name in [row.get("name", ""), *row.get("aliases", []), *row.get("literalLabels", [])]
        if (key := label_comparison_key(name))
    }


def match_exact_voices(
    targets: list[dict[str, Any]], ordered_source_books: list[dict[str, Any]]
) -> dict[str, dict[str, str]]:
    """Resolve unique exact names/aliases, respecting source order and narrator role."""
    matches = {}
    for target in targets:
        for book in ordered_source_books:
            candidates = [
                voice
                for voice in book.get("voices", [])
                if (
                    (target.get("category") == "narrator" and voice.get("category") == "narrator")
                    or (
                        target.get("category") != "narrator"
                        and voice.get("category") == target.get("category")
                        and bool(_names(target) & _names(voice))
                    )
                )
            ]
            if len(candidates) == 1:
                voice = candidates[0]
                matches[str(target["characterId"])] = {
                    "bookId": str(book["bookId"]),
                    "characterId": str(voice["characterId"]),
                    "revision": str(voice["revision"]),
                }
                break
            if candidates:
                # Ambiguity in the highest-priority source must not silently pick a later book.
                break
    return matches


def validated_imported_voices(
    imported: object, targets: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Keep destination identities authoritative and require a reviewable voice snapshot."""
    by_id = {str(row["characterId"]): row for row in targets}
    if not isinstance(imported, dict) or not set(imported).issubset(by_id):
        raise CastContractError("Voice reuse returned unknown destination identities")
    result = {}
    for character_id, row in imported.items():
        if (
            not isinstance(row, dict)
            or not row.get("voicePreviewRevision")
            or not row.get("referenceAudio")
        ):
            raise CastContractError("Voice reuse returned an incomplete voice snapshot")
        identity = {
            key: deepcopy(value)
            for key, value in by_id[character_id].items()
            if key in {"characterId", "name", "category", "literalLabels", "lineCount"}
        }
        merged = {**deepcopy(row), **identity, "voiceAccepted": False, "reusedVoiceSnapshot": True}
        merged.pop("acceptedVoiceRevision", None)
        result[character_id] = merged
    return result


def validate_cast_proposal_inputs(
    proposal: dict[str, Any], dialogue: dict[str, Any], review: dict[str, Any]
) -> None:
    """Reject outdated identity decisions before previews, matching, or paid casting."""
    if str(proposal.get("dialogueRevision", "")) != str(dialogue.get("revision", "")) or str(
        proposal.get("reviewRevision", "")
    ) != str(review.get("revision", "")):
        raise CastContractError("The reviewed book changed. Refresh Cast before generating voices")
