"""Typed workflow dispatch independent of HTTP and queue persistence."""

from __future__ import annotations

from collections.abc import Callable

from ..queue import ProgressReporter
from .commands import WorkflowCommand, command_from_job

WorkflowResult = dict[str, object]
WorkflowHandler = Callable[[WorkflowCommand, ProgressReporter], WorkflowResult]


class WorkflowRunner:
    """Dispatch commands by stable command kind; edition routing stays outside the core."""

    def __init__(self) -> None:
        self._handlers: dict[str, WorkflowHandler] = {}

    def register(self, kind: str, handler: WorkflowHandler) -> None:
        self._handlers[kind] = handler

    def run(self, command: WorkflowCommand, report: ProgressReporter) -> WorkflowResult:
        handler = self._handlers.get(command.kind)
        if handler is None:
            raise ValueError(f"No workflow handler registered for command: {command.kind}")
        return handler(command, report)

    def job_handler(self, kind: str) -> Callable[[dict[str, object], ProgressReporter], WorkflowResult]:
        def handle(payload: dict[str, object], report: ProgressReporter) -> WorkflowResult:
            return self.run(command_from_job(kind, payload), report)

        return handle
