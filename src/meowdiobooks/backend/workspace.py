"""Filesystem boundary for one Book's immutable local workflow package."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from meowdiobooks.util import write_json

from .artifacts import active_artifacts, artifact_history, read_artifact, write_artifact


DOWNSTREAM_ARTIFACTS = {
    "extraction": ("dialogue", "review", "cast", "enrichment", "script"),
    "dialogue": ("review", "cast", "enrichment", "script"),
    "review": ("cast", "enrichment", "script"),
    "cast": ("enrichment", "script"),
    "enrichment": ("script",),
    "script": (),
}


@dataclass(frozen=True, slots=True)
class BookWorkspace:
    root: Path

    @classmethod
    def under(cls, data_root: Path, book_id: str) -> BookWorkspace:
        if not book_id:
            raise ValueError("Book ID is required")
        return cls(data_root / "packages" / book_id)

    @property
    def preview_root(self) -> Path:
        return self.root / "preview"

    @property
    def audio_root(self) -> Path:
        return self.root / "audio"

    @property
    def voices_root(self) -> Path:
        return self.root / "voices"

    def source(self, filename: str) -> Path:
        return self.root / "source" / filename

    def active(self) -> dict[str, str]:
        return active_artifacts(self.root)

    def read(self, kind: str) -> dict[str, object]:
        return read_artifact(self.root, kind)

    def history(self, kind: str) -> list[dict[str, object]]:
        return artifact_history(self.root, kind)

    def candidate(self, kind: str, revision: str) -> dict[str, object]:
        candidate = next(
            (row for row in self.history(kind) if str(row.get("revision")) == revision),
            None,
        )
        if candidate is None:
            raise ValueError(f"{kind.title()} candidate not found")
        return candidate

    def write_candidate(
        self, kind: str, payload: dict[str, object]
    ) -> tuple[Path, dict[str, object]]:
        return write_artifact(self.root, kind, payload, publish=False)

    def publish(self, kind: str, path: Path) -> None:
        """Atomically publish one revision and invalidate only active downstream pointers."""

        if not path.is_file():
            raise ValueError(f"Cannot publish missing {kind} artifact: {path}")
        try:
            downstream = DOWNSTREAM_ARTIFACTS[kind]
        except KeyError as error:
            raise ValueError(f"Unsupported artifact kind: {kind}") from error
        active = self.active()
        active[kind] = str(path)
        for downstream_kind in downstream:
            active.pop(downstream_kind, None)
        write_json(self.root / "artifacts" / "latest.json", active)
