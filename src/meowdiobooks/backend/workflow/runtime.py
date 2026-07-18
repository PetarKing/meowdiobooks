"""Runtime-neutral workflow capability types."""

from collections.abc import Callable


ProgressReporter = Callable[[float, str | None], None]
