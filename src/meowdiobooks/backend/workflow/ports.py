"""Narrow runtime capabilities supplied by local or future hosted composition roots."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Protocol

from ..queue import ProgressReporter


class DocumentExtractor(Protocol):
    def extract(
        self, source: Path, preview_root: Path, method: str, report: ProgressReporter
    ) -> list[dict[str, object]]: ...


class VoiceAuditioner(Protocol):
    def render(
        self,
        workspace: Path,
        book_id: str,
        characters: Sequence[Mapping[str, object]],
        report: ProgressReporter,
        language: str,
        recipe: str,
    ) -> list[dict[str, object]]: ...


class ChapterRenderer(Protocol):
    def render(
        self,
        workspace: Path,
        book_id: str,
        plan: Mapping[str, object],
        language: str,
        report: ProgressReporter,
        recipe: str,
    ) -> list[dict[str, object]]: ...
