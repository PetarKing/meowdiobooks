"""Typed workflow dispatch independent of HTTP and queue persistence."""

from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel

from .definition import WorkflowDefinition
from .runtime import ProgressReporter

WorkflowResult = dict[str, object]
WorkflowHandler = Callable[[BaseModel, ProgressReporter], WorkflowResult]


class WorkflowRunner:
    """Dispatch commands by stable command kind; edition routing stays outside the core."""

    def __init__(self, definition: WorkflowDefinition) -> None:
        self.definition = definition
        self._handlers: dict[str, WorkflowHandler] = {}

    def register(self, kind: str, handler: WorkflowHandler) -> None:
        self.definition.stage_for_command(kind)
        self._handlers[kind] = handler

    def register_stage(self, stage_id: str, handler: WorkflowHandler) -> None:
        stage = self.definition.stage(stage_id)
        if stage.command_kind is None:
            raise ValueError(f"Stage {stage_id} has no workflow command")
        self.register(stage.command_kind, handler)

    def run(self, command: BaseModel, report: ProgressReporter) -> WorkflowResult:
        kind = str(getattr(command, "kind", ""))
        handler = self._handlers.get(kind)
        if handler is None:
            raise ValueError(f"No workflow handler registered for command: {kind}")
        return handler(command, report)

    def job_handler(self, kind: str) -> Callable[[dict[str, object], ProgressReporter], WorkflowResult]:
        def handle(payload: dict[str, object], report: ProgressReporter) -> WorkflowResult:
            return self.run(self.definition.command_from_job(kind, payload), report)

        return handle
