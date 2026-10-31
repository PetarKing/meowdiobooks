"""Validated, request-scoped audiobook packaging for generated chapter WAV revisions."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path

from scipy.io import wavfile

from .models import AudioExportPreset


class FFmpegUnavailableError(RuntimeError):
    """The optional export executable is not installed."""


class M4BExportError(RuntimeError):
    """The selected chapter revisions cannot be packaged safely."""


@dataclass(frozen=True)
class M4BChapter:
    chapter_id: str
    title: str
    audio_path: Path


@dataclass(frozen=True)
class AudioExportProfile:
    preset: AudioExportPreset
    extension: str
    media_type: str
    bitrate: str


_AUDIO_EXPORT_PROFILES = {
    AudioExportPreset.M4B_HIGH: AudioExportProfile(
        AudioExportPreset.M4B_HIGH, ".m4b", "audio/mp4", "128k"
    ),
    AudioExportPreset.M4B_COMPACT: AudioExportProfile(
        AudioExportPreset.M4B_COMPACT, ".m4b", "audio/mp4", "64k"
    ),
    AudioExportPreset.MP3_CHAPTERS: AudioExportProfile(
        AudioExportPreset.MP3_CHAPTERS, ".zip", "application/zip", "96k"
    ),
    AudioExportPreset.MP3: AudioExportProfile(
        AudioExportPreset.MP3, ".mp3", "audio/mpeg", "96k"
    ),
}


def audio_export_profile(preset: AudioExportPreset) -> AudioExportProfile:
    return _AUDIO_EXPORT_PROFILES[preset]


def package_audio_export(
    chapters: list[M4BChapter],
    output: Path,
    *,
    title: str,
    author: str,
    cover: Path,
    preset: AudioExportPreset,
    description: str | None = None,
    ffmpeg: str | None = None,
    command_runner=None,
) -> Path:
    """Package selected WAV revisions using one allowlisted audiobook preset."""
    profile = audio_export_profile(preset)
    if preset == AudioExportPreset.MP3_CHAPTERS:
        return package_mp3_chapters(
            chapters,
            output,
            title=title,
            author=author,
            description=description,
            cover=cover,
            bitrate=profile.bitrate,
            ffmpeg=ffmpeg,
            **({"command_runner": command_runner} if command_runner is not None else {}),
        )
    return _package_single_audio(
        chapters,
        output,
        title=title,
        author=author,
        description=description,
        cover=cover,
        bitrate=profile.bitrate,
        mp3=preset == AudioExportPreset.MP3,
        ffmpeg=ffmpeg,
        **({"command_runner": command_runner} if command_runner is not None else {}),
    )


def package_m4b(
    chapters: list[M4BChapter],
    output: Path,
    *,
    title: str,
    author: str,
    cover: Path,
    description: str | None = None,
    bitrate: str = "128k",
    ffmpeg: str | None = None,
    command_runner=None,
) -> Path:
    """Create one chaptered AAC/M4B without modifying the source WAV revisions."""
    return _package_single_audio(
        chapters, output, title=title, author=author, cover=cover,
        description=description, bitrate=bitrate, ffmpeg=ffmpeg, command_runner=command_runner,
    )


def _package_single_audio(
    chapters: list[M4BChapter], output: Path, *, title: str, author: str, cover: Path,
    description: str | None = None, bitrate: str = "128k", ffmpeg: str | None = None,
    command_runner=None, mp3: bool = False,
) -> Path:
    format_name = "MP3" if mp3 else "M4B"
    executable = ffmpeg or shutil.which("ffmpeg")
    if not executable:
        raise FFmpegUnavailableError(
            f"{format_name} export requires FFmpeg. Install it with `brew install ffmpeg`, then retry."
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
        _ffmetadata(
            title=title,
            author=author,
            description=description,
            chapters=chapters,
            durations_ms=durations,
        ),
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
        "libmp3lame" if mp3 else "aac",
        "-b:a",
        bitrate,
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic",
        *(["-ac", "1", "-id3v2_version", "3", "-metadata", f"album={title}"] if mp3
          else ["-metadata", "media_type=2"]),
        "-metadata:s:v:0",
        "title=Cover",
        "-metadata:s:v:0",
        "comment=Cover (front)",
        *([] if mp3 else ["-movflags", "+faststart"]),
        "-f",
        "mp3" if mp3 else "mp4",
        str(output),
    ]
    try:
        (command_runner if command_runner is not None else subprocess.run)(command, check=True, capture_output=True, timeout=3600)
    except subprocess.TimeoutExpired as error:
        output.unlink(missing_ok=True)
        raise M4BExportError(f"FFmpeg did not finish the {format_name} export within one hour") from error
    except subprocess.CalledProcessError as error:
        output.unlink(missing_ok=True)
        detail = error.stderr.decode("utf-8", errors="replace").strip()
        raise M4BExportError(
            f"FFmpeg could not create the {format_name}: {detail or 'unknown error'}"
        ) from error
    if not output.is_file() or output.stat().st_size == 0:
        output.unlink(missing_ok=True)
        raise M4BExportError(f"FFmpeg reported success but produced no {format_name} data")
    return output


def package_mp3_chapters(
    chapters: list[M4BChapter],
    output: Path,
    *,
    title: str,
    author: str,
    cover: Path,
    description: str | None = None,
    bitrate: str = "96k",
    ffmpeg: str | None = None,
    command_runner=None,
) -> Path:
    """Create a ZIP containing one ordered, tagged MP3 per selected chapter."""
    executable = ffmpeg or shutil.which("ffmpeg")
    if not executable:
        raise FFmpegUnavailableError(
            "MP3 export requires FFmpeg. Install it with `brew install ffmpeg`, then retry."
        )
    if not chapters:
        raise M4BExportError("Select at least one generated chapter to export")
    if not cover.is_file():
        raise M4BExportError("No export cover image is available")

    output.parent.mkdir(parents=True, exist_ok=True)
    chapter_root = output.parent / "mp3-chapters"
    shutil.rmtree(chapter_root, ignore_errors=True)
    chapter_root.mkdir()
    width = max(2, len(str(len(chapters))))
    try:
        packaged: list[Path] = []
        for index, chapter in enumerate(chapters, start=1):
            _wav_duration_ms(chapter.audio_path)
            filename = f"{index:0{width}d} - {_safe_filename_stem(chapter.title)}.mp3"
            destination = chapter_root / filename
            command = [
                executable,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(chapter.audio_path),
                "-i",
                str(cover),
                "-map",
                "0:a:0",
                "-map",
                "1:v:0",
                "-ac",
                "1",
                "-c:a",
                "libmp3lame",
                "-b:a",
                bitrate,
                "-c:v",
                "mjpeg",
                "-disposition:v:0",
                "attached_pic",
                "-id3v2_version",
                "3",
                "-metadata",
                f"title={chapter.title}",
                "-metadata",
                f"artist={author}",
                "-metadata",
                f"album={title}",
                *(["-metadata", f"description={description}"] if description else []),
                *(["-metadata", f"comment={description}"] if description else []),
                "-metadata",
                "genre=Audiobook",
                "-metadata",
                f"track={index}/{len(chapters)}",
                "-metadata:s:v:0",
                "title=Cover",
                "-metadata:s:v:0",
                "comment=Cover (front)",
                str(destination),
            ]
            (command_runner if command_runner is not None else subprocess.run)(command, check=True, capture_output=True, timeout=3600)
            if not destination.is_file() or destination.stat().st_size == 0:
                raise M4BExportError(f"FFmpeg produced no MP3 for {chapter.title}")
            packaged.append(destination)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            for chapter in packaged:
                archive.write(chapter, arcname=chapter.name)
    except subprocess.TimeoutExpired as error:
        output.unlink(missing_ok=True)
        raise M4BExportError("FFmpeg did not finish an MP3 chapter within one hour") from error
    except subprocess.CalledProcessError as error:
        output.unlink(missing_ok=True)
        detail = error.stderr.decode("utf-8", errors="replace").strip()
        raise M4BExportError(
            f"FFmpeg could not create the MP3 chapters: {detail or 'unknown error'}"
        ) from error
    except (OSError, zipfile.BadZipFile) as error:
        output.unlink(missing_ok=True)
        raise M4BExportError("The MP3 chapter ZIP could not be created") from error
    finally:
        shutil.rmtree(chapter_root, ignore_errors=True)
    if not output.is_file() or output.stat().st_size == 0:
        output.unlink(missing_ok=True)
        raise M4BExportError("The MP3 chapter ZIP is empty")
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


def export_filename(
    title: str,
    *,
    partial: bool,
    preset: AudioExportPreset = AudioExportPreset.M4B_HIGH,
) -> str:
    base = _safe_filename_stem(title)
    if preset == AudioExportPreset.MP3_CHAPTERS:
        suffix = " - selected MP3 chapters" if partial else " - MP3 chapters"
        return f"{base}{suffix}.zip"
    selected = " - selected chapters" if partial else ""
    if preset == AudioExportPreset.MP3:
        return f"{base}{selected}.mp3"
    compact = " - smaller" if preset == AudioExportPreset.M4B_COMPACT else ""
    return f"{base}{selected}{compact}.m4b"


def _safe_filename_stem(value: str) -> str:
    base = re.sub(r"[^\w. -]+", "", value, flags=re.UNICODE).strip(" .-")
    base = re.sub(r"\s+", " ", base or "Meowdiobooks")[:120].rstrip(" .-")
    return base or "Meowdiobooks"


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
    *,
    title: str,
    author: str,
    description: str | None,
    chapters: list[M4BChapter],
    durations_ms: list[int],
) -> str:
    lines = [
        ";FFMETADATA1",
        f"title={_metadata_escape(title)}",
        f"artist={_metadata_escape(author)}",
        f"album={_metadata_escape(title)}",
        "genre=Audiobook",
    ]
    if description:
        lines.append(f"description={_metadata_escape(description)}")
        lines.append(f"comment={_metadata_escape(description)}")
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
