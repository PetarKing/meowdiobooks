"""Immutable stage artifacts with one atomic active-pointer map per book package."""

from __future__ import annotations

import json
from pathlib import Path
from collections.abc import Mapping
from typing import Literal, cast, overload
from uuid import uuid4

from meowdiobooks.util import write_json

from .artifact_registry import ArtifactRegistry, PUBLIC_ARTIFACTS

from .contracts.artifacts import (
    Artifact,
    CastArtifact,
    DialogueArtifact,
    EnrichmentArtifact,
    ExtractionArtifact,
    RecordingScriptArtifact,
    ReviewArtifact,
)

ARTIFACT_KINDS = PUBLIC_ARTIFACTS.kinds


def active_artifacts(
    package: Path, registry: ArtifactRegistry = PUBLIC_ARTIFACTS
) -> dict[str, str]:
    """Return only the current v2 pointer map; legacy per-kind pointers are unsupported."""
    pointer = package / "artifacts" / "latest.json"
    if not pointer.is_file():
        return {}
    payload = json.loads(pointer.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Artifact pointer must contain an object")
    result = {str(kind): str(path) for kind, path in payload.items()}
    unknown = sorted(set(result) - registry.kinds)
    if unknown:
        raise RuntimeError(f"Unsupported legacy artifact kinds: {unknown}")
    return result


def artifact_path(
    package: Path, kind: str, registry: ArtifactRegistry = PUBLIC_ARTIFACTS
) -> Path:
    _validate_kind(kind, registry)
    value = active_artifacts(package, registry).get(kind)
    if not value:
        raise ValueError(f"{kind.title()} has not completed")
    path = Path(value)
    if not path.is_file():
        raise RuntimeError(f"Published {kind} artifact is missing: {path}")
    return path


@overload
def read_artifact(package: Path, kind: Literal["extraction"]) -> ExtractionArtifact: ...


@overload
def read_artifact(package: Path, kind: Literal["dialogue"]) -> DialogueArtifact: ...


@overload
def read_artifact(package: Path, kind: Literal["review"]) -> ReviewArtifact: ...


@overload
def read_artifact(package: Path, kind: Literal["cast"]) -> CastArtifact: ...


@overload
def read_artifact(package: Path, kind: Literal["enrichment"]) -> EnrichmentArtifact: ...


@overload
def read_artifact(package: Path, kind: Literal["script"]) -> RecordingScriptArtifact: ...


@overload
def read_artifact(package: Path, kind: str) -> Artifact: ...


def read_artifact(
    package: Path, kind: str, registry: ArtifactRegistry = PUBLIC_ARTIFACTS
) -> Artifact:
    payload = json.loads(artifact_path(package, kind, registry).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"{kind.title()} artifact must contain an object")
    if (
        payload.get("contract") != registry.spec(kind).contract
        or payload.get("kind") != kind
        or not payload.get("revision")
    ):
        raise RuntimeError(f"{kind.title()} artifact has an invalid contract header")
    return cast(Artifact, payload)


def write_artifact(
    package: Path,
    kind: str,
    payload: Mapping[str, object],
    *,
    publish: bool = True,
    registry: ArtifactRegistry = PUBLIC_ARTIFACTS,
) -> tuple[Path, Artifact]:
    """Write one immutable revision and optionally atomically make it active."""
    _validate_kind(kind, registry)
    revision = str(payload.get("revision") or uuid4().hex)
    artifact = {
        **payload,
        "contract": registry.spec(kind).contract,
        "kind": kind,
        "revision": revision,
    }
    path = package / "artifacts" / kind / f"{revision}.json"
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing != artifact:
            raise RuntimeError(f"Immutable {kind} revision conflicts: {revision}")
    else:
        write_json(path, artifact)
    if publish:
        publish_artifact(package, kind, path, registry)
    return path, cast(Artifact, artifact)


def publish_artifact(
    package: Path,
    kind: str,
    path: Path,
    registry: ArtifactRegistry = PUBLIC_ARTIFACTS,
) -> None:
    _validate_kind(kind, registry)
    if not path.is_file():
        raise ValueError(f"Cannot publish missing {kind} artifact: {path}")
    active = active_artifacts(package, registry)
    active[kind] = str(path)
    write_json(package / "artifacts" / "latest.json", active)


def artifact_history(
    package: Path, kind: str, registry: ArtifactRegistry = PUBLIC_ARTIFACTS
) -> list[Artifact]:
    _validate_kind(kind, registry)
    directory = package / "artifacts" / kind
    rows: list[Artifact] = []
    for path in sorted(directory.glob("*.json"), key=lambda item: (item.stat().st_mtime_ns, item.name)):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            isinstance(payload, dict)
            and payload.get("contract") == registry.spec(kind).contract
            and payload.get("kind") == kind
            and payload.get("revision")
        ):
            rows.append(cast(Artifact, payload))
    return rows


def _validate_kind(kind: str, registry: ArtifactRegistry = PUBLIC_ARTIFACTS) -> None:
    registry.spec(kind)
