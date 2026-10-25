"""Artifact-driven Qwen synthesis for v2 render plans."""

from __future__ import annotations

import gc
import os
import re
import shutil
import struct
import unicodedata
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping, Sequence
from uuid import uuid4

import numpy as np
from scipy.io import wavfile

from meowdiobooks.util import write_json

from .audio import QWEN_GENERATION_ATTEMPTS, mix_audio_tracks
from .model_config import asset_path, load_model_registry
from .native_runtime import NativeModelLoader, load_native_model


class TTSContractError(ValueError):
    """Raised when a compiled render plan cannot be published safely."""


_CHAPTER_GAP_SECONDS = 0.24
_WAV_COPY_SAMPLES = 256 * 1024


def render_plan_audio(
    repo_root: Path,
    package: Path,
    book_id: str,
    plan: Mapping[str, Any],
    language: str,
    report: Callable[[float, str | None], None],
    model_id: str | None = None,
    *,
    model_loader: NativeModelLoader | None = None,
) -> list[dict[str, Any]]:
    """Render complete chapters from a v2 plan and publish each atomically.

    The renderer never receives Extraction text and cannot infer speakers. Every
    text, source-span, effective-character and voice-reference choice must already
    be present in ``plan``.
    """

    if plan.get("contract") != "meowdiobooks.render-plan.v2":
        raise TTSContractError("Generation requires a compiled v2 render plan")
    if not language.strip():
        raise TTSContractError("Generation requires an accepted TTS language")
    chapters = list(plan.get("chapters", []))
    if not chapters:
        raise TTSContractError("Render plan contains no selected chapters")
    cleanup_stale_audio_staging(package)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    model, clear_cache = (
        _load_model(repo_root, model_id) if model_loader is None
        else _load_model(repo_root, model_id, model_loader=model_loader)
    )
    try:
        sample_rate = int(model.sample_rate)
        units_by_chapter = [_render_units(list(row.get("segments", []))) for row in chapters]
        total = max(sum(len(rows) for rows in units_by_chapter), 1)
        completed = 0
        results: list[dict[str, Any]] = []
        report(2, f"Making chapter audio from {total} passages")
        for chapter, render_units in zip(chapters, units_by_chapter, strict=True):
            chapter_id = str(chapter.get("chapterId", "")).strip()
            if not chapter_id:
                raise TTSContractError("Render-plan chapter has no chapterId")
            revision = uuid4().hex
            audio_root = package / "audio" / chapter_id
            final_dir = audio_root / revision
            staging = audio_root / f".{revision}.staging"
            if staging.exists():
                shutil.rmtree(staging)
            (staging / "segments").mkdir(parents=True)
            piece_paths: list[Path] = []
            metadata: list[dict[str, Any]] = []
            try:
                for index, unit in enumerate(render_units, 1):
                    segment = dict(unit[0])
                    text = _clean_text(str(segment.get("text", "")))
                    if not text:
                        metadata.append(
                            {
                                **segment,
                                "index": index,
                                "file": None,
                                "skipped": "no-speakable-text",
                            }
                        )
                        completed += 1
                        report(
                            2 + completed / total * 94,
                            f"{chapter_id}: retained non-speech segment {index} of "
                            f"{len(render_units)}",
                        )
                        continue
                    report(
                        2 + completed / total * 94,
                        f"{chapter_id}: segment {index} of {len(render_units)}",
                    )
                    rendered = [
                        _synthesize(model, text, member, package, language) for member in unit
                    ]
                    audio = mix_audio_tracks(rendered) if len(rendered) > 1 else rendered[0]
                    path = staging / "segments" / f"{index:05d}.wav"
                    wavfile.write(path, sample_rate, audio)
                    piece_paths.append(path)
                    metadata_row = {
                        **segment,
                        "index": index,
                        "file": str(path.relative_to(staging)),
                    }
                    if len(unit) > 1:
                        metadata_row.update(
                            {
                                "mixed": True,
                                "mixedSegments": [
                                    {
                                        "id": row.get("id"),
                                        "effectiveCharacterId": row.get("effectiveCharacterId"),
                                        "effectiveSpeaker": row.get("effectiveSpeaker"),
                                        "voiceRevision": row.get("voiceRevision"),
                                    }
                                    for row in unit
                                ],
                            }
                        )
                    metadata.append(metadata_row)
                    completed += 1
                    # The segment WAV is now authoritative inside staging. Release model output
                    # before synthesizing the next passage instead of retaining a whole chapter.
                    del audio, rendered
                assembled_samples = _assemble_chapter_wav(
                    staging / "chapter.wav",
                    piece_paths,
                    sample_rate,
                )
                receipt = {
                    "contract": "meowdiobooks.chapter-audio.v2",
                    "bookId": book_id,
                    "chapterId": chapter_id,
                    "revision": revision,
                    "inputRevisions": dict(plan.get("inputRevisions", {})),
                    "sampleRate": sample_rate,
                    "audioSeconds": assembled_samples / sample_rate,
                    "segments": metadata,
                    "omissions": list(chapter.get("omissions", [])),
                    "renderer": {
                        "model": "qwen-1.7b-base-4bit",
                        "language": language,
                    },
                }
                write_json(staging / "metadata.json", receipt)
                # The previous playable revision remains intact until this directory is complete.
                final_dir.parent.mkdir(parents=True, exist_ok=True)
                staging.replace(final_dir)
                write_json(
                    audio_root / "latest.json", {"revision": revision, "path": str(final_dir)}
                )
                results.append(
                    {
                        "chapterId": chapter_id,
                        "revision": revision,
                        "artifactPath": str(final_dir / "chapter.wav"),
                        "metadataPath": str(final_dir / "metadata.json"),
                        "audioSeconds": receipt["audioSeconds"],
                        "segments": len(metadata),
                    }
                )
            except Exception:
                shutil.rmtree(staging, ignore_errors=True)
                raise
    finally:
        del model
        gc.collect()
        clear_cache()
    report(100, "Selected chapters are playable")
    return results


def _assemble_chapter_wav(
    output: Path,
    segment_paths: Sequence[Path],
    sample_rate: int,
    *,
    gap_seconds: float = _CHAPTER_GAP_SECONDS,
) -> int:
    """Assemble float32 mono segments without retaining chapter audio in memory."""

    if sample_rate <= 0:
        raise TTSContractError("Chapter audio requires a positive sample rate")
    gap_samples = int(sample_rate * gap_seconds)
    if gap_samples < 0:
        raise TTSContractError("Chapter audio gap cannot be negative")

    lengths = [_segment_length(path, sample_rate) for path in segment_paths]
    total_samples = (
        sum(lengths) + gap_samples * (len(lengths) - 1) if lengths else gap_samples
    )
    silence = b"\0" * (gap_samples * np.dtype("<f4").itemsize)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        handle.write(_float32_mono_wav_header(sample_rate, total_samples))
        if not segment_paths:
            handle.write(silence)
        for index, path in enumerate(segment_paths):
            _copy_segment_samples(handle, path, sample_rate, lengths[index])
            if index + 1 < len(segment_paths):
                handle.write(silence)
    return total_samples


def _segment_length(path: Path, expected_rate: int) -> int:
    sample_rate, samples = wavfile.read(path, mmap=True)
    try:
        _validate_segment_audio(path, sample_rate, samples, expected_rate)
        return int(samples.shape[0])
    finally:
        _close_memmap(samples)


def _copy_segment_samples(
    handle: BinaryIO,
    path: Path,
    expected_rate: int,
    expected_length: int,
) -> None:
    sample_rate, samples = wavfile.read(path, mmap=True)
    try:
        _validate_segment_audio(path, sample_rate, samples, expected_rate)
        if int(samples.shape[0]) != expected_length:
            raise TTSContractError(f"Chapter segment changed while assembling: {path.name}")
        for start in range(0, expected_length, _WAV_COPY_SAMPLES):
            chunk = np.ascontiguousarray(
                samples[start : start + _WAV_COPY_SAMPLES], dtype=np.dtype("<f4")
            )
            handle.write(memoryview(chunk).cast("B"))
    finally:
        _close_memmap(samples)


def _validate_segment_audio(
    path: Path,
    sample_rate: int,
    samples: np.ndarray,
    expected_rate: int,
) -> None:
    if int(sample_rate) != expected_rate:
        raise TTSContractError(f"Chapter segment has an unexpected sample rate: {path.name}")
    if samples.ndim != 1 or samples.dtype.kind != "f" or samples.dtype.itemsize != 4:
        raise TTSContractError(f"Chapter segment is not float32 mono audio: {path.name}")


def _close_memmap(samples: np.ndarray) -> None:
    mapping = getattr(samples, "_mmap", None)
    if mapping is not None:
        mapping.close()


def _float32_mono_wav_header(sample_rate: int, sample_count: int) -> bytes:
    """Return the same IEEE-float RIFF/RF64 envelope used by scipy.wavfile.write."""

    bytes_per_sample = np.dtype("<f4").itemsize
    data_size = sample_count * bytes_per_sample
    fmt = struct.pack(
        "<HHIIHH",
        3,  # WAVE_FORMAT_IEEE_FLOAT
        1,
        sample_rate,
        sample_rate * bytes_per_sample,
        bytes_per_sample,
        bytes_per_sample * 8,
    ) + b"\0\0"
    fmt_chunk = b"fmt " + struct.pack("<I", len(fmt)) + fmt
    fact_chunk = b"fact" + struct.pack("<II", 4, min(sample_count, 0xFFFFFFFF))

    riff_file_size = 12 + len(fmt_chunk) + len(fact_chunk) + 8 + data_size
    if riff_file_size - 8 <= 0xFFFFFFFF:
        return (
            b"RIFF"
            + struct.pack("<I", riff_file_size - 8)
            + b"WAVE"
            + fmt_chunk
            + fact_chunk
            + b"data"
            + struct.pack("<I", data_size)
        )

    rf64_file_size = 12 + 36 + len(fmt_chunk) + len(fact_chunk) + 8 + data_size
    ds64_chunk = b"ds64" + struct.pack(
        "<IQQQI",
        28,
        rf64_file_size - 8,
        data_size,
        sample_count,
        0,
    )
    return (
        b"RF64"
        + struct.pack("<I", 0xFFFFFFFF)
        + b"WAVE"
        + ds64_chunk
        + fmt_chunk
        + fact_chunk
        + b"data"
        + struct.pack("<I", 0xFFFFFFFF)
    )


def cleanup_stale_audio_staging(package: Path) -> None:
    """Remove unpublished staging directories left by whole-process interruption."""
    for staging in (package / "audio").glob("*/.*.staging"):
        shutil.rmtree(staging, ignore_errors=True)


def _load_model(
    repo_root: Path, model_id: str | None, *, model_loader: NativeModelLoader | None = None,
) -> tuple[Any, Callable[[], None]]:
    pipeline = load_model_registry(repo_root).voice_pipeline(model_id)
    path = asset_path(repo_root, pipeline.renderer_path)
    if not path.is_dir():
        raise RuntimeError("The required local voice model is not installed")
    return load_native_model(path, "tts", model_loader)


def _synthesize(
    model: Any,
    text: str,
    segment: Mapping[str, Any],
    package: Path,
    language: str,
) -> np.ndarray:
    reference = Path(str(segment.get("referenceAudio", "")))
    if not reference.is_absolute():
        reference = package / reference
    reference_text = str(segment.get("referenceText", "")).strip()
    reference_mode = str(segment.get("referenceMode") or "transcript-conditioned")
    if reference_mode not in {"transcript-conditioned", "speaker-embedding"}:
        raise TTSContractError(
            f"Accepted voice reference mode is unsupported for "
            f"{segment.get('effectiveCharacterId')}"
        )
    if not reference.is_file() or (
        reference_mode == "transcript-conditioned" and not reference_text
    ):
        raise TTSContractError(
            f"Accepted voice reference is unavailable for {segment.get('effectiveCharacterId')}"
        )
    rendered: list[np.ndarray] = []
    for unit_index, unit in enumerate(_synthesis_units(text), 1):
        errors: list[str] = []
        for attempt, settings in enumerate(QWEN_GENERATION_ATTEMPTS, 1):
            try:
                reference_args = {"ref_audio": str(reference)}
                if reference_mode == "transcript-conditioned":
                    reference_args["ref_text"] = reference_text
                chunks = _valid_chunks(
                    model.generate(
                        unit,
                        lang_code=language,
                        split_pattern="",
                        **reference_args,
                        **settings,
                    )
                )
                if chunks:
                    rendered.append(np.concatenate(chunks))
                    break
                errors.append(f"attempt {attempt}: no usable samples")
            except Exception as error:  # local model backends expose heterogeneous failures
                errors.append(f"attempt {attempt}: {type(error).__name__}: {error}")
        else:
            raise RuntimeError(
                f"No audio for segment {segment.get('id')} unit {unit_index}: " + "; ".join(errors)
            )
    if not rendered:
        raise TTSContractError(f"Render segment {segment.get('id')} produced no audio")
    return np.concatenate(rendered)


def _clean_text(text: str) -> str:
    value = re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()
    return value if any(character.isalnum() for character in value) else ""


def _synthesis_units(text: str) -> list[str]:
    return [
        unit.strip()
        for unit in re.split(
            r"(?<=[.!?…。！？])\s+|(?<=[.!?…。！？][\"'”’»）】」』])\s+",
            _clean_text(text),
        )
        if _clean_text(unit)
    ]


def _valid_chunks(results: Any) -> list[np.ndarray]:
    chunks = []
    for result in results:
        audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        if audio.size and np.all(np.isfinite(audio)):
            chunks.append(audio)
    return chunks


def _render_units(segments: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group adjacent joint-speaker tracks so they occupy one timeline slot."""

    units: list[list[dict[str, Any]]] = []
    for segment in segments:
        mix_group = segment.get("mixGroupId")
        if mix_group and units and units[-1][0].get("mixGroupId") == mix_group:
            units[-1].append(segment)
        else:
            units.append([segment])
    return units
