"""Small, crash-safe JSON stores for local application state."""

import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from collections.abc import Callable
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from .models import Book

logger = logging.getLogger(__name__)

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
            return list(self._read()[1].values())

    def get(self, item_id: str) -> T | None:
        with self._lock:
            return self._read()[1].get(item_id)

    def put(self, item: T) -> T:
        with self._lock:
            raw, _items = self._read()
            raw[item.id] = item.model_dump(mode="json")  # type: ignore[attr-defined]
            self._write(raw)
            return item

    def put_many(self, values: list[T]) -> list[T]:
        """Persist a related set of model changes with one atomic file replacement."""
        with self._lock:
            raw, _items = self._read()
            for item in values:
                raw[item.id] = item.model_dump(mode="json")  # type: ignore[attr-defined]
            self._write(raw)
            return values

    def update(self, item_id: str, change: Callable[[T], T]) -> T | None:
        """Atomically read, change, and persist one item under the store lock."""
        with self._lock:
            raw, items = self._read()
            item = items.get(item_id)
            if item is None:
                return None
            updated = change(item)
            raw[item_id] = updated.model_dump(mode="json")
            self._write(raw)
            return updated

    def delete(self, item_id: str) -> T | None:
        """Remove one item and return it when it existed."""
        with self._lock:
            raw, items = self._read()
            removed = items.get(item_id)
            if removed is not None:
                del raw[item_id]
                self._write(raw)
            return removed

    def delete_where(self, predicate: Callable[[T], bool]) -> list[T]:
        """Remove matching items with one atomic file replacement."""
        with self._lock:
            raw, items = self._read()
            removed_keys = {key for key, item in items.items() if predicate(item)}
            removed = [item for key, item in items.items() if key in removed_keys]
            if removed:
                kept = {key: item for key, item in raw.items() if key not in removed_keys}
                self._write(kept)
            return removed

    def _read(self) -> tuple[dict[str, Any], dict[str, T]]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(f"Cannot read state file {self.path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise RuntimeError(f"State file {self.path} must contain an object")
        items: dict[str, T] = {}
        for key, value in raw.items():
            try:
                items[key] = self.model.model_validate(value)
            except ValidationError:
                if self.model is not Book:
                    raise
                # Never log validation input: it can include private book text or titles.
                logger.warning("Skipping invalid stored book record")
        return raw, items

    def _write(self, payload: dict[str, Any]) -> None:
        # Keep skipped records verbatim when a healthy book is changed. Filtering is
        # a read boundary, not permission to remove or rewrite the original data.
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
