"""Runtime-neutral workflow capability types."""

from collections.abc import Callable
from typing import Protocol, runtime_checkable


class ProgressReporter(Protocol):
    def __call__(self, progress: float, message: str | None = None) -> None: ...


@runtime_checkable
class PublicationReporter(ProgressReporter, Protocol):
    """Optional final publication boundary serialized with job cancellation."""

    def commit(self, publish: Callable[[], dict[str, object]]) -> dict[str, object]: ...


def commit_publication(
    report: ProgressReporter, publish: Callable[[], dict[str, object]], message: str
) -> dict[str, object]:
    """Plain direct-run reporters keep their cooperative checkpoint contract."""

    report(100, message)
    if isinstance(report, PublicationReporter):
        return report.commit(publish)
    return publish()
