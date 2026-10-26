"""Deterministic, destination-owned reuse of accepted local voice auditions.

The supplied book store is the authorization boundary. No remote URL or provider
receipt is copied: local audio files and their reference transcript are the voice.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable

from .artifacts import read_artifact
from .models import Book
from .storage import ModelStore
from .voice_reuse import match_latest_voices, validate_source_book_ids


def _component(value: object) -> str:
    value = str(value)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise ValueError("Invalid voice snapshot identifier")
    return value


def _field(book: Any, key: str) -> str:
    return str(book.get(key, "") if isinstance(book, dict) else getattr(book, key, ""))


def _write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".reuse-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class LocalVoiceReuse:
    requires_quote = False

    def __init__(self, *, books: ModelStore[Book], package_for_book: Callable[[str], Path],
                 cast_for_book: Callable[[str], dict[str, Any]] | None = None) -> None:
        self.books = books
        self.package_for_book = package_for_book
        self.cast_for_book = cast_for_book or (lambda key: read_artifact(package_for_book(key), "cast"))

    def _audio(self, book_id: str, voice: dict[str, Any]) -> tuple[bytes, bytes]:
        package = self.package_for_book(book_id).resolve()
        root = package / "voices"
        character_id = _component(voice["characterId"])
        revision = _component(voice["revision"])
        relative = Path(str(voice.get("referenceAudio") or f"voices/{character_id}/{revision}.wav"))
        # Shared voices retain the anchor's directory. Resolve that owner only from
        # the accepted candidate's exact, package-relative reference, never its URL.
        if (relative.is_absolute() or len(relative.parts) != 3 or relative.parts[0] != "voices"
                or relative.name not in {f"{revision}.wav", f"{revision}.reference.wav"}):
            raise ValueError("Voice audio is outside its snapshot")
        owner_id = _component(relative.parts[1])
        preview = (root / owner_id / f"{revision}.wav").resolve()
        reference = (package / relative).resolve()
        if (root not in preview.parents or root not in reference.parents
                or reference.parent != preview.parent
                or reference.name not in {f"{revision}.wav", f"{revision}.reference.wav"}):
            raise ValueError("Voice audio is outside its snapshot")
        data, ref = preview.read_bytes(), reference.read_bytes()
        if not data or not ref:
            raise ValueError("Voice audio is empty")
        return data, ref

    def _discover(self, book_id: str, language: str, model_id: str) -> list[dict[str, Any]]:
        result = []
        for book in self.books.all():
            source_id = _field(book, "id")
            if source_id == book_id:
                continue
            try:
                _component(source_id)
                cast = self.cast_for_book(source_id)
                if (cast.get("status") != "accepted" or cast.get("language") != language
                        or cast.get("voiceModel") != model_id):
                    continue
                voices = []
                rows = [cast.get("narrator"), *cast.get("identities", [])]
                for row in rows:
                    if not isinstance(row, dict) or not row.get("voiceAccepted"):
                        continue
                    revision = str(row.get("acceptedVoiceRevision") or "")
                    if not revision:
                        continue
                    candidates = row.get("voiceCandidates") or []
                    selected = next((c for c in candidates if c.get("revision") == revision), None)
                    if selected is None:
                        if candidates or row.get("voicePreviewRevision") != revision:
                            continue
                        selected = row
                    voice = {**deepcopy(row), **deepcopy(selected), "revision": revision,
                             "characterId": str(row.get("characterId") or row.get("id") or "")}
                    mode = voice.get("referenceMode") or "transcript-conditioned"
                    if mode not in {"speaker-embedding", "transcript-conditioned"}:
                        continue
                    if mode == "transcript-conditioned" and not str(voice.get("referenceText") or "").strip():
                        continue
                    # Candidate defaults refer to its revision, never a different active reference.
                    voice["referenceAudio"] = selected.get("referenceAudio") or f"voices/{voice['characterId']}/{revision}.wav"
                    try:
                        self._audio(source_id, voice)
                    except (OSError, ValueError):
                        continue
                    voices.append(voice)
                if voices:
                    result.append({"bookId": source_id, "title": _field(book, "title"),
                                   "createdAt": _field(book, "created_at"), "voices": voices})
            except (OSError, ValueError, RuntimeError, TypeError, KeyError):
                continue
        return result

    def _sources(self, book_id, source_book_ids, language, model_id):
        _component(book_id)
        if self.books.get(book_id) is None:
            raise ValueError("Destination book is unavailable")
        ids = validate_source_book_ids(source_book_ids, book_id)
        available = self._discover(book_id, language, model_id)
        if ids and not set(ids).issubset({b["bookId"] for b in available}):
            raise ValueError("Voice source is no longer available")
        return [b for b in available if not ids or b["bookId"] in ids]

    @staticmethod
    def _fingerprint(targets, sources, language, model_id):
        identities = [{key: row.get(key) for key in
                       ("characterId", "name", "category", "aliases", "literalLabels")}
                      for row in targets]
        return hashlib.sha256(json.dumps([
            sorted(identities, key=lambda row: row["characterId"]),
            sorted(sources, key=lambda book: book["bookId"]), language, model_id,
        ], sort_keys=True, default=str).encode()).hexdigest()

    def preview(self, book_id, package, targets, source_book_ids, language, model_id):
        sources = self._sources(book_id, source_book_ids, language, model_id)
        matches = match_latest_voices(targets, sources)
        titles = {b["bookId"]: b["title"] for b in sources}
        return {"sources": [], "options": [], "exactMatchCount": len(matches),
                "remainingVoiceCount": len(targets), "totalVoiceCount": len(targets),
                "fingerprint": self._fingerprint(targets, sources, language, model_id),
                "previousVoiceMatches": {label: {"bookTitle": titles[matches[t["characterId"]]["bookId"]]}
                    for t in targets if t["characterId"] in matches for label in t.get("literalLabels", [])}}

    def apply(self, book_id, package, targets, source_book_ids, language, model_id, *, preview_fingerprint=None):
        sources = self._sources(book_id, source_book_ids, language, model_id)
        if preview_fingerprint is not None and preview_fingerprint != self._fingerprint(targets, sources, language, model_id):
            raise ValueError("Voice sources or cast changed. Refresh before continuing.")
        matches = match_latest_voices(targets, sources)
        return {t["characterId"]: self.import_voice(book_id, package, t, matches[t["characterId"]], language, model_id)
                for t in targets if t["characterId"] in matches}

    def import_voice(self, book_id, package, target, source_voice, language, model_id):
        sources = self._sources(book_id, [source_voice["bookId"]], language, model_id)
        book = sources[0]
        voice = next((v for v in book["voices"] if v["characterId"] == source_voice["characterId"]
                      and v["revision"] == source_voice["revision"]), None)
        if voice is None:
            raise ValueError("Source voice changed. Refresh before continuing.")
        preview, reference = self._audio(book["bookId"], voice)
        target_id = _component(target["characterId"])
        revision = hashlib.sha256(json.dumps([book["bookId"], voice["characterId"], voice["revision"],
                    target_id, language, model_id], sort_keys=True).encode() + preview + reference).hexdigest()
        root = Path(package).resolve()
        directory = (root / "voices" / target_id).resolve()
        if root not in directory.parents:
            raise ValueError("Destination voice directory is outside the book")
        directory.mkdir(parents=True, exist_ok=True)
        _write(directory / f"{revision}.wav", preview)
        _write(directory / f"{revision}.reference.wav", reference)
        candidate = {"revision": revision, "source": "previous-book", "previousBookTitle": book["title"],
                     "previewUrl": f"/api/books/{_component(book_id)}/voices/{target_id}/{revision}/audio",
                     "referenceAudio": f"voices/{target_id}/{revision}.reference.wav",
                     "referenceText": voice.get("referenceText"),
                     "referenceMode": voice.get("referenceMode") or "transcript-conditioned",
                     "direction": voice.get("direction") or voice.get("voiceDirection"),
                     "voiceSettings": deepcopy(voice.get("voiceSettings"))}
        return {**deepcopy(target), **candidate, "voicePreviewRevision": revision,
                "voiceDirection": candidate["direction"], "voiceAccepted": False,
                "reusedVoiceSnapshot": True, "voiceCandidates": [candidate]}
