"""Typed top-level shapes for immutable workflow artifacts.

Nested phase structures remain owned and validated by their phase modules. This contract removes
untyped artifact envelopes without duplicating every phase's semantic validator.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class ArtifactHeader(TypedDict):
    contract: str
    kind: str
    revision: str


class ExtractionArtifact(ArtifactHeader):
    kind: Literal["extraction"]
    method: NotRequired[str]
    methodVersion: NotRequired[str]
    pageCount: NotRequired[int]
    pages: NotRequired[list[dict[str, object]]]
    blocks: NotRequired[list[dict[str, object]]]
    boundaryCandidates: NotRequired[list[dict[str, object]]]
    warnings: NotRequired[list[dict[str, object]]]


class DialogueArtifact(ArtifactHeader):
    kind: Literal["dialogue"]
    extractionRevision: NotRequired[str]
    spans: NotRequired[list[dict[str, object]]]
    partition: NotRequired[list[dict[str, object]]]
    settings: NotRequired[dict[str, object]]
    conflicts: NotRequired[list[dict[str, object]]]
    structuralIssues: NotRequired[list[dict[str, object]]]


class ReviewArtifact(ArtifactHeader):
    kind: Literal["review"]
    dialogueRevision: NotRequired[str]
    status: NotRequired[str]
    warnings: NotRequired[list[dict[str, object]]]
    boundaryCandidates: NotRequired[list[dict[str, object]]]
    decisions: NotRequired[list[dict[str, object]]]
    boundaryDecisions: NotRequired[list[dict[str, object]]]
    canStartCast: NotRequired[bool]


class CastArtifact(ArtifactHeader):
    kind: Literal["cast"]
    dialogueRevision: NotRequired[str]
    reviewRevision: NotRequired[str]
    phase: NotRequired[Literal["identity-review", "audition-review", "accepted"]]
    narrator: NotRequired[dict[str, object]]
    identities: NotRequired[list[dict[str, object]]]
    labelToCharacterId: NotRequired[dict[str, str]]


class RecordingScriptArtifact(ArtifactHeader):
    kind: Literal["script"]
    status: NotRequired[Literal["ready"]]
    inputRevisions: NotRequired[dict[str, str | None]]
    entries: NotRequired[list[dict[str, object]]]
    chapters: NotRequired[list[dict[str, object]]]
    summary: NotRequired[dict[str, object]]


Artifact = (
    ExtractionArtifact
    | DialogueArtifact
    | ReviewArtifact
    | CastArtifact
    | RecordingScriptArtifact
)
