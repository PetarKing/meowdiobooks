"""Composable workflow definitions independent of HTTP, queues, and providers."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

from pydantic import BaseModel

from ..artifact_registry import ArtifactRegistry


_STAGE_ID = re.compile(r"^[a-z][a-z0-9-]*$")


@dataclass(frozen=True, slots=True)
class StageSpec:
    id: str
    prerequisites: tuple[str, ...] = ()
    command_kind: str | None = None
    command_model: type[BaseModel] | None = None
    artifact_kind: str | None = None

    def __post_init__(self) -> None:
        if not _STAGE_ID.fullmatch(self.id):
            raise ValueError(f"Invalid workflow stage ID: {self.id}")
        if len(self.prerequisites) != len(set(self.prerequisites)):
            raise ValueError(f"Stage {self.id} has duplicate prerequisites")
        if (self.command_kind is None) != (self.command_model is None):
            raise ValueError(
                f"Stage {self.id} must define both command kind and command model, or neither"
            )


@dataclass(frozen=True, slots=True)
class WorkflowDefinition:
    version: str
    stages: tuple[StageSpec, ...]
    artifacts: ArtifactRegistry

    def __post_init__(self) -> None:
        if not self.version:
            raise ValueError("Workflow definition requires a version")
        ids = [stage.id for stage in self.stages]
        if len(ids) != len(set(ids)):
            raise ValueError("Workflow stage IDs must be unique")
        command_kinds = [stage.command_kind for stage in self.stages if stage.command_kind]
        if len(command_kinds) != len(set(command_kinds)):
            raise ValueError("Workflow command kinds must be unique")
        known = set(ids)
        for stage in self.stages:
            unknown = sorted(set(stage.prerequisites) - known)
            if unknown:
                raise ValueError(f"Stage {stage.id} has unknown prerequisites: {unknown}")
            if stage.id in stage.prerequisites:
                raise ValueError(f"Stage {stage.id} cannot require itself")
            if stage.artifact_kind is not None:
                self.artifacts.spec(stage.artifact_kind)
        for stage in self.stages:
            self._assert_acyclic(stage.id, (), set())

    @property
    def command_kinds(self) -> tuple[str, ...]:
        return tuple(stage.command_kind for stage in self.stages if stage.command_kind is not None)

    def stage(self, stage_id: str) -> StageSpec:
        try:
            return next(stage for stage in self.stages if stage.id == stage_id)
        except StopIteration as error:
            raise ValueError(f"Unknown workflow stage: {stage_id}") from error

    def stage_for_command(self, command_kind: str) -> StageSpec:
        try:
            return next(stage for stage in self.stages if stage.command_kind == command_kind)
        except StopIteration as error:
            raise ValueError(f"Unknown workflow command: {command_kind}") from error

    def insert_after(self, anchor_id: str, stage: StageSpec) -> WorkflowDefinition:
        anchor = self.stage(anchor_id)
        if stage.id in {current.id for current in self.stages}:
            raise ValueError(f"Workflow stage already exists: {stage.id}")
        index = self.stages.index(anchor) + 1
        return replace(self, stages=(*self.stages[:index], stage, *self.stages[index:]))

    def remove(self, stage_id: str) -> WorkflowDefinition:
        self.stage(stage_id)
        dependents = [stage.id for stage in self.stages if stage_id in stage.prerequisites]
        if dependents:
            raise ValueError(f"Stage {stage_id} is still required by: {dependents}")
        return replace(self, stages=tuple(stage for stage in self.stages if stage.id != stage_id))

    def replace(self, stage: StageSpec) -> WorkflowDefinition:
        self.stage(stage.id)
        return replace(
            self,
            stages=tuple(stage if current.id == stage.id else current for current in self.stages),
        )

    def change_prerequisites(
        self, stage_id: str, prerequisites: tuple[str, ...]
    ) -> WorkflowDefinition:
        return self.replace(replace(self.stage(stage_id), prerequisites=prerequisites))

    def with_artifacts(self, artifacts: ArtifactRegistry) -> WorkflowDefinition:
        return replace(self, artifacts=artifacts)

    def command_for_stage(
        self, stage_id: str, book_id: str, settings: dict[str, object]
    ) -> BaseModel:
        stage = self.stage(stage_id)
        if stage.command_kind is None or stage.command_model is None:
            raise ValueError(f"Stage {stage_id} has no workflow command")
        return stage.command_model.model_validate(
            {"kind": stage.command_kind, "book_id": book_id, "settings": settings}
        )

    def command_from_job(self, command_kind: str, payload: dict[str, object]) -> BaseModel:
        stage = self.stage_for_command(command_kind)
        assert stage.command_model is not None
        return stage.command_model.model_validate(
            {
                "kind": command_kind,
                "book_id": payload.get("book_id"),
                "settings": payload.get("settings", {}),
            }
        )

    def _assert_acyclic(
        self, stage_id: str, path: tuple[str, ...], complete: set[str]
    ) -> None:
        if stage_id in complete:
            return
        if stage_id in path:
            raise ValueError(f"Workflow stage cycle: {' -> '.join((*path, stage_id))}")
        stage = self.stage(stage_id)
        next_path = (*path, stage_id)
        for prerequisite in stage.prerequisites:
            self._assert_acyclic(prerequisite, next_path, complete)
        complete.add(stage_id)
