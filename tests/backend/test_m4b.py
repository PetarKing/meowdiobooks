import subprocess
import shutil
import json
import wave
from pathlib import Path

import pytest

from meowdiobooks.backend.m4b import (
    FFmpegUnavailableError,
    M4BChapter,
    embedded_chapter_titles,
    export_filename,
    package_m4b,
)


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
