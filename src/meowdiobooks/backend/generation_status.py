"""Projection of generated chapter audio against current accepted inputs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .artifacts import artifact_history


def generated_chapters(
    package: Path, current_inputs: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    rows = []
    audio = package / "audio"
    for pointer in sorted(audio.glob("*/latest.json")):
        try:
            value = json.loads(pointer.read_text(encoding="utf-8"))
            revision = str(value["revision"])
            chapter_id = pointer.parent.name
            metadata_path = pointer.parent / revision / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (KeyError, OSError, ValueError, json.JSONDecodeError):
            continue
        pinned = metadata.get("inputRevisions", {})
        expected = current_inputs or {}
        stale_reasons = chapter_audio_stale_reasons(package, metadata, expected)
        revisions = []
        for candidate in sorted(pointer.parent.glob("*/metadata.json")):
            try:
                receipt = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            revisions.append(
                {
                    "revision": receipt.get("revision"),
                    "audioSeconds": receipt.get("audioSeconds"),
                    "segments": len(receipt.get("segments", [])),
                    "inputRevisions": receipt.get("inputRevisions", {}),
                }
            )
        rows.append(
            {
                "chapterId": chapter_id,
                "revision": revision,
                "audioUrl": f"/api/books/{metadata['bookId']}/chapters/{chapter_id}/{revision}/audio",
                "audioSeconds": metadata.get("audioSeconds"),
                "segments": list(metadata.get("segments", [])),
                "segmentCount": len(metadata.get("segments", [])),
                "inputRevisions": pinned,
                "current": not stale_reasons,
                "staleReasons": stale_reasons,
                "revisions": revisions,
            }
        )
    return rows


def chapter_audio_stale_reasons(
    package: Path,
    metadata: dict[str, Any],
    current_inputs: dict[str, Any],
) -> list[str]:
    """Report only render-affecting input changes for one generated chapter.

    Stage revisions remain immutable audit identities, but revisiting an accepted stage can
    publish a new revision whose effective TTS inputs are unchanged. Snapshot and export must
    use the same compatibility decision so playable audio never appears current in one surface
    and stale in the other.
    """

    pinned = dict(metadata.get("inputRevisions", {}))
    reasons = []
    for kind, current_revision in current_inputs.items():
        if current_revision is None:
            continue
        pinned_revision = pinned.get(kind)
        if str(pinned_revision or "") == str(current_revision):
            continue
        if kind in {"cast", "script"} and _render_artifacts_equivalent(
            package,
            kind,
            str(pinned_revision or ""),
            str(current_revision),
            chapter_id=str(metadata.get("chapterId") or ""),
        ):
            continue
        reasons.append(f"{kind}:{pinned_revision}->{current_revision}")
    return reasons


def _render_artifacts_equivalent(
    package: Path,
    kind: str,
    pinned_revision: str,
    current_revision: str,
    *,
    chapter_id: str = "",
) -> bool:
    pinned = _artifact_revision(package, kind, pinned_revision)
    current = _artifact_revision(package, kind, current_revision)
    if pinned is None or current is None:
        return False
    if kind == "cast":
        return _cast_render_signature(pinned) == _cast_render_signature(current)
    if kind == "script":
        return _script_render_signature(pinned, chapter_id) == _script_render_signature(
            current, chapter_id
        )
    return False


def _artifact_revision(package: Path, kind: str, revision: str) -> dict[str, Any] | None:
    if not revision:
        return None
    return next(
        (
            row
            for row in artifact_history(package, kind)
            if str(row.get("revision") or "") == revision
        ),
        None,
    )


def _cast_render_signature(cast: dict[str, Any]) -> dict[str, Any]:
    def voice(raw: Any) -> dict[str, Any]:
        row = raw if isinstance(raw, dict) else {}
        route = row.get("voiceRoute")
        if isinstance(route, dict) and route.get("kind") == "layered":
            normalized_route: dict[str, Any] = {
                "kind": "layered",
                "characterIds": [str(value) for value in route.get("characterIds", [])],
            }
        else:
            normalized_route = {"kind": "dedicated"}
        return {
            "characterId": str(row.get("characterId") or ""),
            "name": str(row.get("name") or row.get("characterId") or ""),
            "category": str(row.get("category") or "character"),
            "voiceAccepted": row.get("voiceAccepted") is True,
            "voiceRevision": str(
                row.get("acceptedVoiceRevision") or row.get("voiceRevision") or ""
            ),
            "referenceAudio": str(row.get("referenceAudio") or row.get("referenceAudioPath") or ""),
            "referenceText": str(row.get("referenceText") or ""),
            "voiceRoute": normalized_route,
        }

    return {
        "voiceModel": cast.get("voiceModel"),
        "language": cast.get("language"),
        "labelToCharacterId": cast.get("labelToCharacterId", {}),
        "narrator": voice(cast.get("narrator")),
        "identities": [voice(row) for row in cast.get("identities", [])],
    }


def _script_render_signature(script: dict[str, Any], chapter_id: str = "") -> dict[str, Any]:
    entries = script.get("entries", [])
    if chapter_id and entries and all(row.get("chapterId") for row in entries):
        entries = [row for row in entries if str(row.get("chapterId") or "") == chapter_id]
    return {
        "status": script.get("status"),
        "entries": entries,
        "sourceCoverage": script.get("sourceCoverage", {}),
    }
