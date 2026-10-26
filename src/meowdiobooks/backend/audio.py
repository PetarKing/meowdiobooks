"""Local Qwen voice-reference generation for character review."""

from __future__ import annotations

import gc
import io
import math
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

from .errors import WorkflowInputError
from .model_config import asset_path, load_model_registry
from .native_runtime import NativeModelLoader, load_native_model


# Qwen evaluates released checkpoints with the generation-config defaults below. Keep the
# primary path aligned with that configuration; cooler alternatives are bounded recovery
# attempts for empty or non-finite output. Keep the former runtime's 4096-token
# limit explicit: mlx-audio 0.6 inherits max_new_tokens from the checkpoint.
QWEN_GENERATION_ATTEMPTS = (
    {"temperature": 0.9, "top_k": 50, "top_p": 1.0, "repetition_penalty": 1.05,
     "max_tokens": 4096},
    {"temperature": 0.75, "top_k": 40, "top_p": 1.0, "repetition_penalty": 1.05,
     "max_tokens": 4096},
    {"temperature": 0.65, "top_k": 30, "top_p": 1.0, "repetition_penalty": 1.05,
     "max_tokens": 4096},
)

VOICE_SAMPLE_SUFFIXES = {".wav", ".mp3", ".flac"}
VOICE_SAMPLE_RATE = 24_000
VOICE_SAMPLE_MIN_SECONDS = 3.0
VOICE_SAMPLE_MAX_SECONDS = 30.0


def normalize_voice_sample(raw: bytes, filename: str) -> tuple[bytes, float]:
    """Decode one ordinary audio file and return a bounded mono 24 kHz WAV."""

    suffix = Path(filename).suffix.casefold()
    if suffix not in VOICE_SAMPLE_SUFFIXES:
        raise WorkflowInputError("Use a WAV, MP3, or FLAC voice sample")
    if not raw:
        raise WorkflowInputError("Voice sample is empty")

    from mlx_audio.audio_io import read as read_audio

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as source:
            source.write(raw)
            source.flush()
            samples, sample_rate = read_audio(source.name, dtype="float32")
    except (OSError, RuntimeError, ValueError) as error:
        raise WorkflowInputError("Voice sample could not be decoded") from error

    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim == 2:
        audio = np.mean(audio, axis=1, dtype=np.float32)
    audio = audio.reshape(-1)
    if sample_rate <= 0 or not audio.size or not np.all(np.isfinite(audio)):
        raise WorkflowInputError("Voice sample contains no usable audio")

    duration = audio.size / float(sample_rate)
    if duration < VOICE_SAMPLE_MIN_SECONDS or duration > VOICE_SAMPLE_MAX_SECONDS:
        raise WorkflowInputError("Voice sample must be between 3 and 30 seconds")
    if float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) < 1e-4:
        raise WorkflowInputError("Voice sample is silent")

    if sample_rate != VOICE_SAMPLE_RATE:
        divisor = math.gcd(int(sample_rate), VOICE_SAMPLE_RATE)
        audio = resample_poly(
            audio,
            VOICE_SAMPLE_RATE // divisor,
            int(sample_rate) // divisor,
        ).astype(np.float32)
    peak = float(np.max(np.abs(audio)))
    if peak > 0.99:
        audio = audio * (0.99 / peak)
    output = io.BytesIO()
    wavfile.write(output, VOICE_SAMPLE_RATE, np.asarray(audio, dtype=np.float32))
    return output.getvalue(), duration


def generate_cloned_audition(
    repo_root: Path,
    reference_audio: Path,
    reference_text: str,
    text: str,
    language: str,
    model_id: str | None = None,
    *,
    model_loader: NativeModelLoader | None = None,
) -> bytes:
    """Render an audition line from a transcript-conditioned speaker reference."""

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    pipeline = load_model_registry(repo_root).voice_pipeline(model_id)
    model_path = asset_path(repo_root, pipeline.renderer_path)
    if not model_path.is_dir():
        raise RuntimeError("The required local voice model is not installed")
    model, release_model = load_native_model(model_path, "tts", model_loader)
    try:
        audio = _generate_cloned_preview(
            model, text, reference_audio, reference_text, language
        )
        output = io.BytesIO()
        wavfile.write(output, int(model.sample_rate), audio)
        return output.getvalue()
    finally:
        del model
        gc.collect()
        release_model()


def mix_audio_tracks(parts: list[np.ndarray]) -> np.ndarray:
    """Mix same-rate mono tracks into one peak-safe timeline slot."""

    if len(parts) < 2:
        raise ValueError("Layered audio requires at least two tracks")
    length = max(len(part) for part in parts)
    padded = [np.pad(np.asarray(part, dtype=np.float32), (0, length - len(part))) for part in parts]
    mixed = np.mean(np.stack(padded), axis=0)
    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    return mixed if peak <= 0.95 else mixed * (0.95 / peak)


def layered_preview_wav(package: Path, members: list[tuple[str, str]]) -> bytes:
    """Mix exact audition revisions without creating another voice artifact."""

    if len(members) < 2 or len(set(members)) != len(members):
        raise ValueError("Layered preview requires at least two unique voice auditions")
    voice_root = (package / "voices").resolve()
    sample_rate: int | None = None
    tracks: list[np.ndarray] = []
    for character_id, revision in members:
        path = (voice_root / character_id / f"{revision}.wav").resolve()
        if voice_root not in path.parents or not path.is_file():
            raise ValueError("Voice audition not found")
        rate, raw = wavfile.read(path)
        if sample_rate is None:
            sample_rate = int(rate)
        elif sample_rate != int(rate):
            raise ValueError("Layered preview auditions use incompatible sample rates")
        audio = np.asarray(raw)
        if audio.ndim == 2:
            audio = np.mean(audio.astype(np.float32), axis=1)
        if np.issubdtype(audio.dtype, np.integer):
            limit = max(abs(np.iinfo(audio.dtype).min), np.iinfo(audio.dtype).max)
            audio = audio.astype(np.float32) / float(limit)
        tracks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
    output = io.BytesIO()
    wavfile.write(output, sample_rate or 1, mix_audio_tracks(tracks))
    return output.getvalue()


def generate_cast_previews(
    repo_root: Path,
    package: Path,
    book_id: str,
    characters: list[dict[str, Any]],
    report: Callable[[float, str | None], None],
    language: str,
    model_id: str | None = None,
    *,
    model_loader: NativeModelLoader | None = None,
) -> list[dict[str, Any]]:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    pipeline = load_model_registry(repo_root).voice_pipeline(model_id)
    model_path = asset_path(repo_root, pipeline.audition_path)
    if not model_path.is_dir():
        raise RuntimeError("The required local voice model is not installed")
    report(2, "Preparing voice auditions")
    report(4, "Preparing voice auditions")
    model, release_model = load_native_model(model_path, "tts", model_loader)
    try:
        report(8, "Starting voice auditions")
        sample_rate = int(model.sample_rate)
        total = max(len(characters), 1)
        generated = 0
        for index, character in enumerate(characters, start=1):
            direction = str(
                character.get("voiceDirection")
                or f"A distinct, natural voice for {character['name']}; consistent and suitable for a novel."
            )
            report(
                8 + (index - 1) / total * 88,
                f"Auditioning {character['name']} ({index} of {total})",
            )
            try:
                text = _preview_text(character)
                audio = _generate_preview(model, text, direction, language)
            except RuntimeError as exc:
                # A failed retry must never discard the last playable candidate.
                character["voicePreviewError"] = str(exc)
                report(
                    8 + index / total * 88,
                    f"Could not audition {character['name']}; continuing with the remaining cast",
                )
                continue
            revision = uuid4().hex
            relative = Path("voices") / character["id"] / f"{revision}.wav"
            output = package / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            wavfile.write(output, sample_rate, audio)
            character["voicePreviewRevision"] = revision
            preview_url = f"/api/books/{book_id}/voices/{character['id']}/{revision}/audio"
            character["previewUrl"] = preview_url
            character["referenceText"] = text
            character["voice"] = direction
            candidates = list(character.get("voiceCandidates", []))
            candidates.append(
                {
                    "revision": revision,
                    "previewUrl": preview_url,
                    "referenceText": text,
                    "direction": direction,
                    "voiceSettings": character.get("voiceSettings"),
                    "parentRevision": candidates[-1]["revision"] if candidates else None,
                }
            )
            character["voiceCandidates"] = candidates
            character.pop("voicePreviewError", None)
            character["accepted"] = False
            generated += 1
            report(
                8 + index / total * 88, f"Generated voice {index} of {total}: {character['name']}"
            )
        if characters and generated == 0:
            failures = "; ".join(
                f"{row.get('name', 'unknown')}: {row.get('voicePreviewError', 'no audio')}"
                for row in characters
            )
            raise RuntimeError(f"No voice auditions could be created. {failures}")
    finally:
        del model
        gc.collect()
        release_model()
    return characters


def _preview_text(character: dict[str, Any]) -> str:
    """Return the complete user-selected audition line without silently truncating it."""
    candidates = (
        character.get("previewLine"),
        character.get("referenceText"),
        character.get("line"),
        *(character.get("previewLines") or []),
    )
    for candidate in candidates:
        text = _clean_text(str(candidate or ""))
        if text:
            return text
    raise RuntimeError(f"No speakable preview line for {character.get('name', 'character')}")


def _clean_text(text: str) -> str:
    # Compatibility normalization changes meaningful audible punctuation
    # (for example full-width ！/？), so retain canonical Unicode forms.
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if any(character.isalnum() for character in text) else ""


def _generate_preview(
    model: Any, text: str, direction: str, language: str = "english"
) -> np.ndarray:
    errors: list[str] = []
    for attempt, settings in enumerate(QWEN_GENERATION_ATTEMPTS, start=1):
        try:
            chunks = _valid_audio_chunks(
                model.generate(
                    text,
                    instruct=direction,
                    lang_code=language,
                    split_pattern="",
                    **settings,
                )
            )
            if chunks:
                return np.concatenate(chunks)
            errors.append(f"attempt {attempt}: model returned no usable samples")
        except Exception as exc:  # model failures vary by backend and must be retryable
            errors.append(f"attempt {attempt}: {type(exc).__name__}: {exc}")
    raise RuntimeError("; ".join(errors))


def _generate_cloned_preview(
    model: Any,
    text: str,
    reference_audio: Path,
    reference_text: str,
    language: str = "english",
) -> np.ndarray:
    errors: list[str] = []
    for attempt, settings in enumerate(QWEN_GENERATION_ATTEMPTS, start=1):
        try:
            chunks = _valid_audio_chunks(
                model.generate(
                    text,
                    ref_audio=str(reference_audio),
                    ref_text=reference_text,
                    lang_code=language,
                    split_pattern="",
                    **settings,
                )
            )
            if chunks:
                return np.concatenate(chunks)
            errors.append(f"attempt {attempt}: model returned no usable samples")
        except Exception as exc:  # model failures vary by backend and must be retryable
            errors.append(f"attempt {attempt}: {type(exc).__name__}: {exc}")
    raise RuntimeError("; ".join(errors))


def _valid_audio_chunks(results: Any) -> list[np.ndarray]:
    chunks: list[np.ndarray] = []
    for result in results:
        audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        if audio.size and np.all(np.isfinite(audio)):
            chunks.append(audio)
    return chunks
