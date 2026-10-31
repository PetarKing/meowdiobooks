"""Private, exact-recipe native speech sections; never accepted audio artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

import numpy as np
from scipy.io import wavfile

from meowdiobooks.util import canonical_json


CHECKPOINT_CONTRACT = "meowdiobooks.native-generation-checkpoint.v1"
CHECKPOINT_DIRECTORY = Path(".checkpoints") / "native-generation"


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def model_installation_signature(root: Path) -> dict[str, Any]:
    """Conservatively notice replaced local files without hashing multi-GB weights.

    The registry's immutable source/revision remains the model identity authority;
    installed pinned weights are trusted. Metadata additionally invalidates normal
    operator replacements, and small configuration/tokenizer files are hashed.
    """
    rows = []
    hashed_bytes = 0
    if not root.is_dir():
        return {"available": False}
    for index, path in enumerate(root.rglob("*"), 1):
        if index > 20_000:
            raise ValueError("Native model installation has too many files to identify safely")
        if not path.is_file():
            continue
        info = path.stat()
        row: dict[str, Any] = {
            "path": str(path.relative_to(root)), "size": info.st_size,
            "modifiedNs": info.st_mtime_ns, "changedNs": info.st_ctime_ns,
        }
        if path.suffix in {".json", ".txt", ".model"} and info.st_size <= 32 * 1024 * 1024:
            hashed_bytes += info.st_size
            if hashed_bytes > 64 * 1024 * 1024:
                raise ValueError("Native model configuration exceeds the identity inspection limit")
            row["sha256"] = file_digest(path)
        rows.append(row)
    return {"files": sorted(rows, key=lambda row: row["path"])}


def chapter_recipe(
    package: Path,
    book_id: str,
    chapter: Mapping[str, Any],
    settings: Mapping[str, Any],
) -> str:
    """Bind all ordered inputs, replacing temporary reference paths with content hashes."""
    references: dict[Path, str] = {}
    segments = []
    for raw in chapter.get("segments", []):
        segment = dict(raw)
        reference = Path(str(segment.get("referenceAudio", "")))
        if not reference.is_absolute():
            reference = package / reference
        # An empty/non-speech segment needs no voice, just as in the renderer.
        if reference.is_file():
            if reference not in references:
                references[reference] = file_digest(reference)
            segment["referenceAudio"] = {"sha256": references[reference]}
        else:
            segment["referenceAudio"] = {"unavailable": True}
        segments.append(segment)
    payload = {
        "contract": CHECKPOINT_CONTRACT,
        "bookId": book_id,
        "chapter": {**chapter, "segments": segments},
        "settings": dict(settings),
    }
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def _safe_directory(path: Path) -> Path:
    absolute = path.absolute()
    for directory in reversed([absolute, *absolute.parents]):
        if directory.is_symlink():
            raise ValueError("Native generation checkpoint directory must not be a symlink")
        directory.mkdir(exist_ok=True, mode=0o700)
        if not directory.is_dir():
            raise ValueError("Native generation checkpoint directory is unavailable")
    return absolute


class GenerationCheckpoint:
    """One recipe's atomic sections and bounded, text-free progress snapshot.

    Callers own the private root and serialize native rendering. Completed recipes
    remain available after chapter assembly: a composition may still fail before
    publishing the entire request. Hosts own retention alongside the book package.
    """

    def __init__(self, root: Path, key: str, total: int, sample_rate: int):
        if len(key) != 64 or any(character not in "0123456789abcdef" for character in key):
            raise ValueError("Native generation checkpoint requires an exact recipe digest")
        self.root = _safe_directory(root).resolve()
        self.path = _safe_directory(self.root / key)
        self.key = key
        self.total = total
        self.sample_rate = sample_rate
        self.completed = 0
        self.restored = 0
        self.started_at = self._now()
        self.progress("running")

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _file(self, name: str) -> Path:
        path = self.path / name
        if path.is_symlink():
            raise ValueError("Native generation checkpoint files must not be symlinks")
        if path.exists() and not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError("Native generation checkpoint files must be regular files")
        return path

    def _atomic_bytes(self, path: Path, content: bytes) -> None:
        temporary = self.path / f".{uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def read(self, section: str, *, quality: dict[str, Any] | None = None,
             ) -> tuple[np.ndarray, list[dict[str, Any]]] | None:
        path = self._file(f"{section}.wav")
        metadata = self._file(f"{section}.json")
        try:
            payload = json.loads(metadata.read_text(encoding="utf-8"))
            if (not isinstance(payload, dict)
                    or payload.get("contract") != CHECKPOINT_CONTRACT
                    or payload.get("key") != self.key
                    or payload.get("section") != section
                    or payload.get("sha256") != file_digest(path)):
                return None
            rate, audio = wavfile.read(path)
            if (rate != self.sample_rate or audio.ndim != 1 or audio.dtype != np.float32
                    or not audio.size or not np.isfinite(audio).all()
                    or payload.get("samples") != len(audio)):
                return None
            recoveries = payload.get("recoveries", [])
            if not isinstance(recoveries, list) or any(
                not isinstance(row, dict) for row in recoveries
            ):
                return None
            if quality is not None and isinstance(payload.get("quality"), dict):
                quality.update(payload["quality"])
            return audio, recoveries
        except (OSError, ValueError, KeyError, TypeError, EOFError, struct.error):
            return None

    def write(self, section: str, audio: np.ndarray, recoveries: list[dict[str, Any]],
              *, quality: dict[str, Any] | None = None) -> None:
        path = self._file(f"{section}.wav")
        metadata = self._file(f"{section}.json")
        temporary = self.path / f".{uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as handle:
                wavfile.write(handle, self.sample_rate, audio)
                handle.flush()
                os.fsync(handle.fileno())
            digest = file_digest(temporary)
            temporary.replace(path)
            self._atomic_bytes(metadata, canonical_json({
                "contract": CHECKPOINT_CONTRACT,
                "key": self.key,
                "section": section,
                "samples": len(audio),
                "sha256": digest,
                "recoveries": recoveries,
                **({"quality": quality} if quality is not None else {}),
            }))
        finally:
            temporary.unlink(missing_ok=True)

    def record_quality(self, section: str, quality: dict[str, Any]) -> None:
        """Upgrade a validated legacy section without rewriting healthy audio."""
        metadata = self._file(f"{section}.json")
        payload = json.loads(metadata.read_text(encoding="utf-8"))
        previous = payload.get("quality", {})
        # Preserve original inference evidence while refreshing waveform scores.
        if isinstance(previous, dict) and isinstance(previous.get("attempts"), list):
            quality = {**quality, "attempts": previous["attempts"]}
        payload["quality"] = quality
        self._atomic_bytes(metadata, canonical_json(payload))

    def advance(self, *, restored: bool = False) -> None:
        self.completed += 1
        self.restored += int(restored)
        self.progress("running")

    def progress(self, state: str) -> None:
        self._atomic_bytes(self._file("progress.json"), canonical_json({
            "contract": CHECKPOINT_CONTRACT,
            "key": self.key,
            "state": state,
            "totalSections": self.total,
            "completedSections": self.completed,
            "restoredSections": self.restored,
            "startedAt": self.started_at,
            "updatedAt": self._now(),
        }))
