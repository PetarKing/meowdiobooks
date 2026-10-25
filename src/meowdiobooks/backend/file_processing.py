"""Optional execution boundary for document parsing and media decoding.

The local application uses its normal functions when no processor is supplied.
Compositions can run these operations in restricted processes while retaining the
same workflow artifacts. Authentication, sandbox policy and limits belong to the host.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Protocol

from .m4b import M4BChapter
from .models import AudioExportPreset


class FileProcessor(Protocol):
    def inspect_source(self, source: Path) -> tuple[str, int]: ...

    def pdf_metadata(self, source: Path) -> dict[str, str]: ...

    def extract_pdf_page(
        self, source: Path, cache_root: Path, page: int, method: str,
    ) -> dict[str, Any]: ...

    def extract_full_document(
        self, source: Path, cache_root: Path, method: str,
        report: Callable[[float, str | None], None] | None = None,
    ) -> list[dict[str, Any]]: ...

    def render_pdf_page(self, source: Path, cache_root: Path, page: int) -> Path: ...

    def normalize_voice_sample(self, raw: bytes, filename: str) -> tuple[bytes, float]: ...

    def package_audio_export(
        self, chapters: Sequence[M4BChapter], output: Path, *, title: str,
        author: str, description: str | None, cover: Path, preset: AudioExportPreset,
    ) -> Path: ...
