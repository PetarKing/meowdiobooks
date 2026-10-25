"""Local, replaceable speech-to-text boundary for voice-reference drafts."""

from __future__ import annotations

import gc
import os
from dataclasses import dataclass
from pathlib import Path

from .model_config import asset_path, load_model_registry
from .native_runtime import NativeModelLoader, load_native_model


@dataclass(frozen=True)
class TranscriptionDraft:
    text: str
    language: str | None


def transcribe_voice_sample(
    repo_root: Path,
    audio_path: Path,
    model_id: str | None = None,
    *,
    model_loader: NativeModelLoader | None = None,
) -> TranscriptionDraft:
    """Draft a transcript without forcing a language.

    The registry-selected engine is deliberately hidden behind this function so a Linux
    runtime can provide another implementation without changing the HTTP or UI contract.
    """

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    configured = load_model_registry(repo_root).transcription_model(model_id)
    model_path = asset_path(repo_root, configured.model_path)
    if not model_path.is_dir():
        raise RuntimeError("The required local speech-recognition model is not installed")
    if configured.engine != "mlx_audio":
        raise RuntimeError(f"Unsupported speech-recognition engine: {configured.engine}")

    model, release_model = load_native_model(model_path, "stt", model_loader)
    try:
        return _draft_from_model(model, audio_path)
    finally:
        del model
        gc.collect()
        release_model()


def _draft_from_model(model: object, audio_path: Path) -> TranscriptionDraft:
    result = model.generate(  # type: ignore[attr-defined]
        str(audio_path),
        language=None,
        temperature=0.0,
        max_tokens=512,
        chunk_duration=30.0,
    )
    text = " ".join(str(getattr(result, "text", "")).split()).strip()
    if not text:
        raise ValueError("No speech could be transcribed from this sample")
    raw_language = getattr(result, "language", None)
    if isinstance(raw_language, (list, tuple)):
        detected = list(dict.fromkeys(str(value).strip() for value in raw_language if str(value).strip()))
        language = ", ".join(detected) or None
    else:
        language = str(raw_language).strip() if raw_language else None
    return TranscriptionDraft(text=text, language=language)
