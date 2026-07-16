"""Validated, request-scoped M4B packaging for generated chapter WAV revisions."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from scipy.io import wavfile


class FFmpegUnavailableError(RuntimeError):
    """The optional export executable is not installed."""


class M4BExportError(RuntimeError):
    """The selected chapter revisions cannot be packaged safely."""


@dataclass(frozen=True)
class M4BChapter:
    chapter_id: str
    title: str
    audio_path: Path


def package_m4b(
    chapters: list[M4BChapter],
    output: Path,
    *,
    title: str,
    author: str,
    cover: Path,
    ffmpeg: str | None = None,
) -> Path:
    """Create one chaptered AAC/M4B without modifying the source WAV revisions."""
    executable = ffmpeg or shutil.which("ffmpeg")
    if not executable:
        raise FFmpegUnavailableError(
            "M4B export requires FFmpeg. Install it with `brew install ffmpeg`, then retry."
        )
    if not chapters:
        raise M4BExportError("Select at least one generated chapter to export")
    if not cover.is_file():
        raise M4BExportError("No export cover image is available")

    output.parent.mkdir(parents=True, exist_ok=True)
    concat_path = output.parent / "chapters.ffconcat"
    metadata_path = output.parent / "metadata.ffmeta"
    durations = [_wav_duration_ms(chapter.audio_path) for chapter in chapters]
    concat_path.write_text(
        "ffconcat version 1.0\n"
        + "".join(
            f"file '{_concat_escape(chapter.audio_path.resolve())}'\n" for chapter in chapters
        ),
        encoding="utf-8",
    )
    metadata_path.write_text(
        _ffmetadata(title=title, author=author, chapters=chapters, durations_ms=durations),
        encoding="utf-8",
    )

    command = [
        executable,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_path),
        "-f",
        "ffmetadata",
        "-i",
        str(metadata_path),
        "-i",
        str(cover),
        "-map",
        "0:a:0",
        "-map",
        "2:v:0",
        "-map_metadata",
        "1",
        "-map_chapters",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic",
        "-metadata",
        "media_type=2",
        "-metadata:s:v:0",
        "title=Cover",
        "-metadata:s:v:0",
        "comment=Cover (front)",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(output),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=3600)
    except subprocess.TimeoutExpired as error:
        output.unlink(missing_ok=True)
        raise M4BExportError("FFmpeg did not finish the M4B export within one hour") from error
    except subprocess.CalledProcessError as error:
        output.unlink(missing_ok=True)
        detail = error.stderr.decode("utf-8", errors="replace").strip()
        raise M4BExportError(
            f"FFmpeg could not create the M4B: {detail or 'unknown error'}"
        ) from error
    if not output.is_file() or output.stat().st_size == 0:
        output.unlink(missing_ok=True)
        raise M4BExportError("FFmpeg reported success but produced no M4B data")
    return output


def extract_embedded_cover(source: Path, *, ffmpeg: str | None = None) -> bytes:
    """Read the front cover embedded in an existing M4B without altering it."""
    executable = ffmpeg or shutil.which("ffmpeg")
    if not executable:
        raise FFmpegUnavailableError("The embedded audiobook cover requires FFmpeg")
    try:
        result = subprocess.run(
            [
                executable,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-c:v",
                "mjpeg",
                "-f",
                "image2pipe",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise M4BExportError("The embedded audiobook cover could not be read") from error
    if not result.stdout:
        raise M4BExportError("The audiobook does not contain a readable cover")
    return result.stdout


def embedded_chapter_titles(source: Path, *, ffprobe: str | None = None) -> list[str]:
    """Read chapter titles from an existing M4B in playback order."""
    executable = ffprobe or shutil.which("ffprobe")
    if not executable:
        raise FFmpegUnavailableError("The embedded audiobook chapters require FFprobe")
    try:
        result = subprocess.run(
            [
                executable,
                "-v",
                "error",
                "-show_entries",
                "chapter_tags=title",
                "-of",
                "json",
                str(source),
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        payload = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise M4BExportError("The embedded audiobook chapters could not be read") from error
    chapters = payload.get("chapters", []) if isinstance(payload, dict) else []
    return [
        title
        for row in chapters
        if isinstance(row, dict)
        and isinstance(row.get("tags"), dict)
        and (title := str(row["tags"].get("title") or "").strip())
    ]


def export_filename(title: str, *, partial: bool) -> str:
    base = re.sub(r"[^\w. -]+", "", title, flags=re.UNICODE).strip(" .-") or "Meowdiobooks"
    base = re.sub(r"\s+", " ", base)[:120].rstrip()
    suffix = " - selected chapters" if partial else ""
    return f"{base}{suffix}.m4b"


def _wav_duration_ms(path: Path) -> int:
    if not path.is_file():
        raise M4BExportError(f"Chapter audio is missing: {path.name}")
    try:
        sample_rate, samples = wavfile.read(path, mmap=True)
    except (OSError, ValueError) as error:
        raise M4BExportError(f"Chapter audio is unreadable: {path.name}") from error
    frames = int(samples.shape[0]) if samples.ndim else int(samples.size)
    if sample_rate <= 0 or frames <= 0:
        raise M4BExportError(f"Chapter audio is empty: {path.name}")
    return max(1, round(frames / sample_rate * 1000))


def _ffmetadata(
    *, title: str, author: str, chapters: list[M4BChapter], durations_ms: list[int]
) -> str:
    lines = [
        ";FFMETADATA1",
        f"title={_metadata_escape(title)}",
        f"artist={_metadata_escape(author)}",
        f"album={_metadata_escape(title)}",
        "genre=Audiobook",
    ]
    start = 0
    for chapter, duration in zip(chapters, durations_ms, strict=True):
        end = start + duration
        lines.extend(
            [
                "",
                "[CHAPTER]",
                "TIMEBASE=1/1000",
                f"START={start}",
                f"END={end}",
                f"title={_metadata_escape(chapter.title)}",
            ]
        )
        start = end
    return "\n".join(lines) + "\n"


def _metadata_escape(value: str) -> str:
    clean = " ".join(value.split())
    return re.sub(r"([=;#\\])", r"\\\1", clean)


def _concat_escape(path: Path) -> str:
    return str(path).replace("'", "'\\''")
