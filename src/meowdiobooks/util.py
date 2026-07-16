from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable

from pydantic import BaseModel


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def canonical_json(value: Any) -> bytes:
    def default(item: Any) -> Any:
        if isinstance(item, BaseModel):
            return item.model_dump(mode="json")
        raise TypeError(f"Cannot canonically serialize {type(item).__name__}")

    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=default,
    ).encode()


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, canonical_json(value) + b"\n")


def write_jsonl(path: Path, values: Iterable[Any]) -> None:
    content = b"".join(canonical_json(value) + b"\n" for value in values)
    atomic_write(path, content)
