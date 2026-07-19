"""Local Cast workflow helpers shared by composition and acceptance."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from .artifacts import artifact_history
from .cast import label_comparison_key
from .cast_service import compile_voice_direction, default_voice_settings
from .languages import audition_line


def _voice_identity_signature(identity: dict[str, Any]) -> tuple[str, frozenset[str]]:
    """Return the cast properties that can materially change a generated voice."""

    return (
        str(identity.get("category", "")),
        frozenset(
            label_comparison_key(label)
            for label in identity.get("literalLabels", [])
            if label_comparison_key(label)
        ),
    )


def _reuse_unchanged_cast_voices(
    finalized: dict[str, Any], previous: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Reuse auditions for identities whose membership and voice category did not change.

    Canonical/display names intentionally do not participate in the signature.  When a
    name changes, the previous opaque character ID is retained so its immutable audition
    URLs and on-disk voice references remain valid.
    """

    previous_by_signature = {}
    for row in previous.get("identities", []):
        if not isinstance(row, dict):
            continue
        signature = _voice_identity_signature(row)
        if signature[1]:
            previous_by_signature[signature] = row
    reused: dict[str, dict[str, Any]] = {}
    for identity in finalized.get("identities", []):
        signature = _voice_identity_signature(identity)
        prior = previous_by_signature.get(signature) if signature[1] else None
        if prior is None:
            continue
        generated_id = str(identity["characterId"])
        character_id = str(prior["characterId"])
        identity["characterId"] = character_id
        for label, mapped_id in finalized.get("labelToCharacterId", {}).items():
            if mapped_id == generated_id:
                finalized["labelToCharacterId"][label] = character_id
        reused[character_id] = {**deepcopy(prior), **identity}
    return reused


def _rebase_accepted_cast(
    package: Path,
    *,
    dialogue_revision: str,
    review_revision: str,
    revision: str,
) -> dict[str, Any] | None:
    """Reuse accepted identities and auditions when only Review changed."""

    previous = next(
        (
            row
            for row in reversed(artifact_history(package, "cast"))
            if row.get("phase") == "accepted"
            and str(row.get("dialogueRevision", "")) == dialogue_revision
        ),
        None,
    )
    if previous is None:
        return None
    return {
        **deepcopy(previous),
        "revision": revision,
        "phase": "audition-review",
        "status": "needs-voice-review",
        "reviewRevision": review_revision,
        "reusedFromRevision": previous["revision"],
    }


def _audition_character(
    identity: dict[str, Any], settings: dict[str, str] | None = None, *, language: str = "english"
) -> dict[str, Any]:
    voice_settings = settings or default_voice_settings(str(identity.get("category", "character")))
    return {
        "id": identity["characterId"],
        "name": identity["name"],
        "category": identity["category"],
        "lineCount": int(identity.get("lineCount", 0)),
        "voiceSettings": voice_settings,
        "voiceDirection": compile_voice_direction(voice_settings, language=language),
        "previewLine": _audition_line(str(identity["name"]), language),
    }


def _audition_line(name: str, language: str) -> str:
    return audition_line(name, language)


def _apply_cast_line_counts(
    finalized: dict[str, Any], proposal: dict[str, Any], spans: list[dict[str, Any]]
) -> int:
    counts = {
        label_comparison_key(row.get("label", "")): int(row.get("occurrenceCount", 0))
        for row in proposal.get("dossiers", [])
    }
    for identity in finalized.get("identities", []):
        labels = {label_comparison_key(value) for value in identity.get("literalLabels", [])}
        identity["lineCount"] = sum(counts.get(label, 0) for label in labels)
    finalized["identities"].sort(
        key=lambda row: (-int(row.get("lineCount", 0)), label_comparison_key(row.get("name", "")))
    )
    narrator_labels = {
        label_comparison_key(row.get("label", ""))
        for row in finalized.get("identityReviewDecisions", [])
        if row.get("category") == "narrator"
    }
    narration = sum(
        1
        for row in spans
        if row.get("renderRole") == "narration"
        and any(character.isalnum() for character in str(row.get("text", "")))
    )
    return narration + sum(counts.get(label, 0) for label in narrator_labels)


def _cast_with_line_counts(cast: dict[str, Any], dialogue: dict[str, Any]) -> dict[str, Any]:
    """Backfill display counts for older immutable Cast artifacts without rewriting them."""

    if not cast or cast.get("phase") not in {"audition-review", "accepted"}:
        return cast
    enriched = deepcopy(cast)
    narrator_count = _apply_cast_line_counts(enriched, enriched, list(dialogue.get("spans", [])))
    if isinstance(enriched.get("narrator"), dict):
        enriched["narrator"]["lineCount"] = narrator_count
    return enriched


def _expand_cast_label_mapping(finalized: dict[str, Any], proposal: dict[str, Any]) -> None:
    """Map source spellings without resurrecting superseded model aliases.

    Reviewed aliases are already included by ``finalize_identity_mapping``. The
    proposal's original alias suggestions are evidence, not an accepted mapping.
    """

    mapping = finalized["labelToCharacterId"]
    dossiers = {str(row.get("label")): row for row in proposal.get("dossiers", [])}
    for label, character_id in list(mapping.items()):
        dossier = dossiers.get(label, {})
        for spelling in dossier.get("sourceSpellings", []):
            mapping[str(spelling)] = character_id


def _audition_identity(
    generated: dict[str, Any], package: Path, *, base: dict[str, Any] | None = None
) -> dict[str, Any]:
    identity = dict(base or {})
    revision = str(generated.get("voicePreviewRevision", ""))
    character_id = str(generated["id"])
    identity.update(
        {
            "characterId": character_id,
            "name": generated["name"],
            "category": generated.get("category", identity.get("category", "character")),
            "lineCount": int(generated.get("lineCount", identity.get("lineCount", 0))),
            "voiceDirection": generated.get("voice") or identity.get("voiceDirection"),
            "voiceSettings": generated.get("voiceSettings") or identity.get("voiceSettings"),
            "voicePreviewRevision": revision or None,
            "previewUrl": generated.get("previewUrl"),
            "referenceText": generated.get("referenceText"),
            "referenceAudio": (
                generated.get("referenceAudio")
                or (str(Path("voices") / character_id / f"{revision}.wav") if revision else None)
            ),
            "voiceCandidates": generated.get("voiceCandidates", []),
            "voicePreviewError": generated.get("voicePreviewError"),
            "voiceAccepted": False,
        }
    )
    return identity


def _shared_audition_identity(
    generated: dict[str, Any],
    base: dict[str, Any],
    group_id: str,
    package: Path,
) -> dict[str, Any]:
    """Project one generated audition onto another identity without copying audio."""

    shared = deepcopy(generated)
    anchor_id = str(generated["id"])
    revision = str(generated.get("voicePreviewRevision", ""))
    reference_audio = str(Path("voices") / anchor_id / f"{revision}.wav") if revision else None
    candidates = []
    for raw in generated.get("voiceCandidates", []):
        candidate = deepcopy(raw)
        candidate_revision = str(candidate.get("revision", ""))
        candidate.update(
            {
                "source": "shared",
                "sharedVoiceGroupId": group_id,
                "referenceAudio": (
                    str(Path("voices") / anchor_id / f"{candidate_revision}.wav")
                    if candidate_revision
                    else None
                ),
            }
        )
        candidates.append(candidate)
    shared.update(
        {
            "id": str(base["characterId"]),
            "name": str(base["name"]),
            "category": str(base.get("category", "character")),
            "lineCount": int(base.get("lineCount", 0)),
            "referenceAudio": reference_audio,
            "voiceCandidates": candidates,
        }
    )
    return _audition_identity(shared, package, base=base)
