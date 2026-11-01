"""Filesystem boundary for one Book's immutable local workflow package."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from collections.abc import Mapping
from threading import RLock

from meowdiobooks.util import write_json

from .artifact_registry import ArtifactRegistry, PUBLIC_ARTIFACTS
from .artifacts import active_artifacts, artifact_history, read_artifact, write_artifact

_PUBLICATION_LOCK = RLock()


@dataclass(frozen=True, slots=True)
class BookWorkspace:
    root: Path
    artifacts: ArtifactRegistry = PUBLIC_ARTIFACTS

    @classmethod
    def under(
        cls,
        data_root: Path,
        book_id: str,
        artifacts: ArtifactRegistry = PUBLIC_ARTIFACTS,
    ) -> BookWorkspace:
        if not book_id:
            raise ValueError("Book ID is required")
        return cls(data_root / "packages" / book_id, artifacts)

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
        return active_artifacts(self.root, self.artifacts)

    def read(self, kind: str) -> dict[str, object]:
        return read_artifact(self.root, kind, self.artifacts)

    def history(self, kind: str) -> list[dict[str, object]]:
        return artifact_history(self.root, kind, self.artifacts)

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
        return write_artifact(
            self.root,
            kind,
            payload,
            publish=False,
            registry=self.artifacts,
        )

    def publish(self, kind: str, path: Path) -> None:
        """Atomically publish one revision and invalidate only active downstream pointers."""

        self.publish_many({kind: path})

    def publish_many(
        self, paths: Mapping[str, Path], *, expected_revisions: Mapping[str, str] | None = None,
    ) -> None:
        """Publish related revisions with one pointer replacement and stale-input check."""

        if not paths:
            raise ValueError("At least one artifact is required for publication")
        with _PUBLICATION_LOCK:
            for kind, path in paths.items():
                self.artifacts.spec(kind)
                if not path.is_file():
                    raise ValueError(f"Cannot publish missing {kind} artifact: {path}")
            for kind, revision in (expected_revisions or {}).items():
                if self.read(kind).get("revision") != revision:
                    raise ValueError("The accepted source changed before publication")
            active = self.active()
            for kind in paths:
                for downstream_kind in self.artifacts.downstream(kind):
                    active.pop(downstream_kind, None)
            active.update({kind: str(path) for kind, path in paths.items()})
            write_json(self.root / "artifacts" / "latest.json", active)
