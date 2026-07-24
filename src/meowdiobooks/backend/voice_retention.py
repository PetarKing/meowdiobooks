"""Retention helpers for the single-current-Cast product contract."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any


def cast_voice_revisions(cast: Mapping[str, Any]) -> frozenset[str]:
    """Return every concrete voice revision reachable from one Cast artifact."""

    revisions: set[str] = set()
    rows = [cast.get("narrator"), *cast.get("identities", [])]
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        for key in ("acceptedVoiceRevision", "voicePreviewRevision", "voiceRevision"):
            revision = str(row.get(key) or "").strip()
            if revision:
                revisions.add(revision)
        candidates = row.get("voiceCandidates")
        if not isinstance(candidates, list):
            continue
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                continue
            revision = str(candidate.get("revision") or "").strip()
            if revision:
                revisions.add(revision)
    return frozenset(revisions)


def prune_voice_files(package: Path, keep_revisions: frozenset[str]) -> None:
    """Delete WAV files that no longer belong to the current Cast voice set."""

    voices = package / "voices"
    if not voices.is_dir():
        return
    for path in voices.rglob("*.wav"):
        revision = _revision_for_voice_path(path)
        if revision and revision not in keep_revisions:
            path.unlink(missing_ok=True)

    for directory in sorted(
        (path for path in voices.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        try:
            directory.rmdir()
        except OSError:
            pass


def _revision_for_voice_path(path: Path) -> str:
    name = path.name
    if name.endswith(".reference.wav"):
        return name[: -len(".reference.wav")]
    if name.endswith(".wav"):
        return name[: -len(".wav")]
    return ""
