"""Small, crash-safe JSON stores for local application state."""

import json
import os
import tempfile
import threading
from pathlib import Path
from collections.abc import Callable
from typing import Generic, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class ModelStore(Protocol[T]):
    """Persistence contract shared by local JSON and hosted database adapters."""

    def all(self) -> list[T]: ...
    def get(self, item_id: str) -> T | None: ...
    def put(self, item: T) -> T: ...
    def put_many(self, values: list[T]) -> list[T]: ...
    def update(self, item_id: str, change: Callable[[T], T]) -> T | None: ...
    def delete(self, item_id: str) -> T | None: ...
    def delete_where(self, predicate: Callable[[T], bool]) -> list[T]: ...


class JsonStore(Generic[T]):
    """Thread-safe model collection persisted with atomic file replacement."""

    def __init__(self, path: Path, model: type[T]) -> None:
        self.path = path
        self.model = model
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({})

    def all(self) -> list[T]:
        with self._lock:
            return list(self._read().values())

    def get(self, item_id: str) -> T | None:
        with self._lock:
            return self._read().get(item_id)

    def put(self, item: T) -> T:
        with self._lock:
            items = self._read()
            items[item.id] = item  # type: ignore[attr-defined]
            self._write(items)
            return item

    def put_many(self, values: list[T]) -> list[T]:
        """Persist a related set of model changes with one atomic file replacement."""
        with self._lock:
            items = self._read()
            for item in values:
                items[item.id] = item  # type: ignore[attr-defined]
            self._write(items)
            return values

    def update(self, item_id: str, change: Callable[[T], T]) -> T | None:
        """Atomically read, change, and persist one item under the store lock."""
        with self._lock:
            items = self._read()
            item = items.get(item_id)
            if item is None:
                return None
            updated = change(item)
            items[item_id] = updated
            self._write(items)
            return updated

    def delete(self, item_id: str) -> T | None:
        """Remove one item and return it when it existed."""
        with self._lock:
            items = self._read()
            removed = items.pop(item_id, None)
            if removed is not None:
                self._write(items)
            return removed

    def delete_where(self, predicate: Callable[[T], bool]) -> list[T]:
        """Remove matching items with one atomic file replacement."""
        with self._lock:
            items = self._read()
            removed_keys = {key for key, item in items.items() if predicate(item)}
            removed = [item for key, item in items.items() if key in removed_keys]
            if removed:
                kept = {key: item for key, item in items.items() if key not in removed_keys}
                self._write(kept)
            return removed

    def _read(self) -> dict[str, T]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(f"Cannot read state file {self.path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise RuntimeError(f"State file {self.path} must contain an object")
        return {key: self.model.model_validate(value) for key, value in raw.items()}

    def _write(self, items: dict[str, T]) -> None:
        payload = {key: value.model_dump(mode="json") for key, value in items.items()}
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            directory_fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
