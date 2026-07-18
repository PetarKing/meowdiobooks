"""Registered immutable artifact contracts and their dependency graph."""

from __future__ import annotations

import re
from dataclasses import dataclass


_KIND = re.compile(r"^[a-z][a-z0-9-]*$")


@dataclass(frozen=True, slots=True)
class ArtifactSpec:
    kind: str
    contract: str
    requires: tuple[str, ...] = ()
    optional: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not _KIND.fullmatch(self.kind):
            raise ValueError(f"Invalid artifact kind: {self.kind}")
        if not self.contract:
            raise ValueError(f"Artifact {self.kind} requires a contract")
        dependencies = (*self.requires, *self.optional)
        if len(dependencies) != len(set(dependencies)):
            raise ValueError(f"Artifact {self.kind} has duplicate dependencies")
        if self.kind in dependencies:
            raise ValueError(f"Artifact {self.kind} cannot depend on itself")


@dataclass(frozen=True, slots=True)
class ArtifactRegistry:
    specs: tuple[ArtifactSpec, ...]

    def __post_init__(self) -> None:
        kinds = [spec.kind for spec in self.specs]
        if len(kinds) != len(set(kinds)):
            raise ValueError("Artifact kinds must be unique")
        known = set(kinds)
        for spec in self.specs:
            unknown = sorted(set((*spec.requires, *spec.optional)) - known)
            if unknown:
                raise ValueError(f"Artifact {spec.kind} has unknown dependencies: {unknown}")
        for kind in kinds:
            self._assert_acyclic(kind, (), set())

    @property
    def kinds(self) -> frozenset[str]:
        return frozenset(spec.kind for spec in self.specs)

    def spec(self, kind: str) -> ArtifactSpec:
        try:
            return next(spec for spec in self.specs if spec.kind == kind)
        except StopIteration as error:
            raise ValueError(f"Unsupported artifact kind: {kind}") from error

    def with_spec(self, spec: ArtifactSpec) -> ArtifactRegistry:
        if spec.kind in self.kinds:
            raise ValueError(f"Artifact kind already registered: {spec.kind}")
        return ArtifactRegistry((*self.specs, spec))

    def replace(self, spec: ArtifactSpec) -> ArtifactRegistry:
        if spec.kind not in self.kinds:
            raise ValueError(f"Cannot replace unknown artifact kind: {spec.kind}")
        return ArtifactRegistry(
            tuple(spec if current.kind == spec.kind else current for current in self.specs)
        )

    def without(self, kind: str) -> ArtifactRegistry:
        self.spec(kind)
        dependents = [
            spec.kind
            for spec in self.specs
            if kind in spec.requires or kind in spec.optional
        ]
        if dependents:
            raise ValueError(f"Artifact {kind} is still referenced by: {dependents}")
        return ArtifactRegistry(tuple(spec for spec in self.specs if spec.kind != kind))

    def downstream(self, kind: str) -> tuple[str, ...]:
        self.spec(kind)
        result: list[str] = []
        pending = [kind]
        while pending:
            upstream = pending.pop(0)
            for spec in self.specs:
                if spec.kind in result:
                    continue
                if upstream in spec.requires or upstream in spec.optional:
                    result.append(spec.kind)
                    pending.append(spec.kind)
        return tuple(result)

    def _assert_acyclic(
        self, kind: str, path: tuple[str, ...], complete: set[str]
    ) -> None:
        if kind in complete:
            return
        if kind in path:
            raise ValueError(f"Artifact dependency cycle: {' -> '.join((*path, kind))}")
        spec = self.spec(kind)
        next_path = (*path, kind)
        for dependency in (*spec.requires, *spec.optional):
            self._assert_acyclic(dependency, next_path, complete)
        complete.add(kind)


PUBLIC_ARTIFACTS = ArtifactRegistry(
    (
        ArtifactSpec("extraction", "meowdiobooks.extraction.v2"),
        ArtifactSpec(
            "dialogue",
            "meowdiobooks.dialogue.v2",
            requires=("extraction",),
        ),
        ArtifactSpec(
            "review",
            "meowdiobooks.review.v2",
            requires=("dialogue",),
        ),
        ArtifactSpec(
            "cast",
            "meowdiobooks.cast.v2",
            requires=("dialogue", "review"),
        ),
        ArtifactSpec(
            "enrichment",
            "meowdiobooks.enrichment.v2",
            requires=("dialogue", "cast"),
        ),
        ArtifactSpec(
            "script",
            "meowdiobooks.script.v2",
            requires=("dialogue", "review", "cast"),
            optional=("enrichment",),
        ),
    )
)
