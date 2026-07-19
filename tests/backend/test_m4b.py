import subprocess
import shutil
import json
import wave
import zipfile
from pathlib import Path

import pytest

from meowdiobooks.backend.m4b import (
    FFmpegUnavailableError,
    M4BChapter,
    M4BExportError,
    embedded_chapter_titles,
    export_filename,
    package_audio_export,
    package_m4b,
    package_mp3_chapters,
)
from meowdiobooks.backend.models import AudioExportPreset


def _wav(path: Path, seconds: float) -> None:
    frames = int(24_000 * seconds)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24_000)
        output.writeframes(b"\0\0" * frames)


def test_package_m4b_writes_ordered_chapters_metadata_and_attached_cover(tmp_path, monkeypatch):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    cover = tmp_path / "cover.png"
    output = tmp_path / "book.m4b"
    _wav(first, 1.25)
    _wav(second, 2.5)
    cover.write_bytes(b"png")
    captured = {}

    def fake_run(command, **settings):
        captured["command"] = command
        captured["settings"] = settings
        captured["concat"] = (tmp_path / "chapters.ffconcat").read_text()
        captured["metadata"] = (tmp_path / "metadata.ffmeta").read_text()
        Path(command[-1]).write_bytes(b"m4b")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("meowdiobooks.backend.m4b.subprocess.run", fake_run)

    result = package_m4b(
        [
            M4BChapter("chapter-1", "Opening #1", first),
            M4BChapter("chapter-2", "Second; act", second),
        ],
        output,
        title="Cats = Magic",
        author="Maou",
        cover=cover,
        ffmpeg="/opt/homebrew/bin/ffmpeg",
    )

    assert result == output
    assert captured["settings"] == {"check": True, "capture_output": True, "timeout": 3600}
    assert captured["concat"].count("file '") == 2
    assert captured["metadata"].count("[CHAPTER]") == 2
    assert "title=Cats \\= Magic" in captured["metadata"]
    assert "title=Opening \\#1" in captured["metadata"]
    assert "START=0\nEND=1250" in captured["metadata"]
    assert "START=1250\nEND=3750" in captured["metadata"]
    assert captured["command"][captured["command"].index("-map_chapters") + 1] == "1"
    assert "attached_pic" in captured["command"]
    assert "media_type=2" in captured["command"]


def test_package_m4b_reports_the_optional_dependency(tmp_path, monkeypatch):
    monkeypatch.setattr("meowdiobooks.backend.m4b.shutil.which", lambda _name: None)

    with pytest.raises(FFmpegUnavailableError, match="brew install ffmpeg"):
        package_m4b([], tmp_path / "book.m4b", title="Book", author="Author", cover=tmp_path)


def test_export_filename_marks_partial_books_and_removes_path_characters():
    assert export_filename("My / Cat: Book", partial=False) == "My Cat Book.m4b"
    assert export_filename("My / Cat: Book", partial=True) == "My Cat Book - selected chapters.m4b"
    assert export_filename(
        "My / Cat: Book", partial=False, preset=AudioExportPreset.M4B_COMPACT
    ) == "My Cat Book - smaller.m4b"
    assert export_filename(
        "My / Cat: Book", partial=True, preset=AudioExportPreset.MP3_CHAPTERS
    ) == "My Cat Book - selected MP3 chapters.zip"


def test_audio_export_compact_preset_uses_64_kbps_aac(tmp_path, monkeypatch):
    chapter = tmp_path / "chapter.wav"
    cover = tmp_path / "cover.png"
    output = tmp_path / "book.m4b"
    _wav(chapter, 1)
    cover.write_bytes(b"png")
    captured = {}

    def fake_run(command, **_settings):
        captured["command"] = command
        Path(command[-1]).write_bytes(b"m4b")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("meowdiobooks.backend.m4b.subprocess.run", fake_run)

    package_audio_export(
        [M4BChapter("chapter-1", "Opening", chapter)],
        output,
        title="Book",
        author="Author",
        cover=cover,
        preset=AudioExportPreset.M4B_COMPACT,
        ffmpeg="ffmpeg",
    )

    command = captured["command"]
    assert command[command.index("-b:a") + 1] == "64k"


def test_mp3_chapter_export_is_ordered_tagged_and_stored_without_recompression(
    tmp_path, monkeypatch
):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    cover = tmp_path / "cover.png"
    output = tmp_path / "book.zip"
    _wav(first, 1)
    _wav(second, 1)
    cover.write_bytes(b"png")
    commands = []

    def fake_run(command, **_settings):
        commands.append(command)
        Path(command[-1]).write_bytes(f"mp3-{len(commands)}".encode())
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("meowdiobooks.backend.m4b.subprocess.run", fake_run)

    package_mp3_chapters(
        [
            M4BChapter("chapter-1", "Opening / Arrival", first),
            M4BChapter("chapter-2", "Second: Act", second),
        ],
        output,
        title="A Cat Finds a Voice",
        author="Maou",
        cover=cover,
        ffmpeg="ffmpeg",
    )

    assert len(commands) == 2
    assert all(command[command.index("-b:a") + 1] == "96k" for command in commands)
    assert "title=Opening / Arrival" in commands[0]
    assert "track=1/2" in commands[0]
    assert "track=2/2" in commands[1]
    with zipfile.ZipFile(output) as archive:
        assert archive.compression == zipfile.ZIP_STORED
        assert archive.namelist() == [
            "01 - Opening Arrival.mp3",
            "02 - Second Act.mp3",
        ]
        assert archive.read(archive.namelist()[0]) == b"mp3-1"


def test_mp3_chapter_export_reports_zip_write_failures(tmp_path, monkeypatch):
    chapter = tmp_path / "chapter.wav"
    cover = tmp_path / "cover.png"
    output = tmp_path / "book.zip"
    _wav(chapter, 1)
    cover.write_bytes(b"png")

    def fake_run(command, **_settings):
        Path(command[-1]).write_bytes(b"mp3")
        return subprocess.CompletedProcess(command, 0)

    class BrokenArchive:
        def __init__(self, *_args, **_settings):
            raise OSError("disk full")

    monkeypatch.setattr("meowdiobooks.backend.m4b.subprocess.run", fake_run)
    monkeypatch.setattr("meowdiobooks.backend.m4b.zipfile.ZipFile", BrokenArchive)

    with pytest.raises(M4BExportError, match="ZIP could not be created"):
        package_mp3_chapters(
            [M4BChapter("chapter-1", "Opening", chapter)],
            output,
            title="Book",
            author="Author",
            cover=cover,
            ffmpeg="ffmpeg",
        )
    assert not output.exists()
    assert not (tmp_path / "mp3-chapters").exists()


def test_embedded_chapter_titles_reads_the_m4b_table_of_contents(tmp_path, monkeypatch):
    source = tmp_path / "book.m4b"
    source.write_bytes(b"m4b")

    def fake_run(command, **settings):
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(
                {
                    "chapters": [
                        {"tags": {"title": "Opening matter"}},
                        {"tags": {"title": "Chapter 1"}},
                    ]
                }
            ).encode(),
        )

    monkeypatch.setattr("meowdiobooks.backend.m4b.subprocess.run", fake_run)

    assert embedded_chapter_titles(source, ffprobe="/opt/homebrew/bin/ffprobe") == [
        "Opening matter",
        "Chapter 1",
    ]


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="FFmpeg is an optional export dependency"
)
def test_real_ffmpeg_output_contains_aac_chapters_metadata_and_cover(tmp_path):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    output = tmp_path / "A Cat Finds a Voice.m4b"
    _wav(first, 1.0)
    _wav(second, 1.5)
    cover = Path(__file__).parents[2] / "frontend/src/assets/brand/meowdiobooks-mark.png"

    package_m4b(
        [
            M4BChapter("chapter-1", "Opening", first),
            M4BChapter("chapter-2", "The Second Cat", second),
        ],
        output,
        title="A Cat Finds a Voice",
        author="Maou",
        cover=cover,
    )

    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_chapters",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(probe.stdout)
    assert [chapter["tags"]["title"] for chapter in payload["chapters"]] == [
        "Opening",
        "The Second Cat",
    ]
    assert payload["format"]["tags"]["title"] == "A Cat Finds a Voice"
    assert payload["format"]["tags"]["artist"] == "Maou"
    assert any(stream["codec_name"] == "aac" for stream in payload["streams"])
    assert any(
        stream.get("disposition", {}).get("attached_pic") == 1 for stream in payload["streams"]
    )


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="FFmpeg is an optional export dependency"
)
def test_real_ffmpeg_mp3_zip_contains_playable_tagged_chapters(tmp_path):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    output = tmp_path / "A Cat Finds a Voice - MP3 chapters.zip"
    _wav(first, 1)
    _wav(second, 1.5)
    cover = Path(__file__).parents[2] / "frontend/src/assets/brand/meowdiobooks-mark.png"

    package_mp3_chapters(
        [
            M4BChapter("chapter-1", "Opening", first),
            M4BChapter("chapter-2", "The Second Cat", second),
        ],
        output,
        title="A Cat Finds a Voice",
        author="Maou",
        cover=cover,
    )

    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert archive.namelist() == ["01 - Opening.mp3", "02 - The Second Cat.mp3"]
        archive.extractall(tmp_path / "unpacked")
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(tmp_path / "unpacked/01 - Opening.mp3"),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(probe.stdout)
    assert payload["format"]["tags"]["title"] == "Opening"
    assert payload["format"]["tags"]["artist"] == "Maou"
    assert payload["format"]["tags"]["album"] == "A Cat Finds a Voice"
    assert payload["format"]["tags"]["track"] == "1/2"
    assert any(stream["codec_name"] == "mp3" for stream in payload["streams"])
    assert any(
        stream.get("disposition", {}).get("attached_pic") == 1 for stream in payload["streams"]
    )
