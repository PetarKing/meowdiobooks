"""Model acquisition seam for local inference without prescribing a host cache."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

ModelKind = Literal["tts", "stt"]
NativeModelLoader = Callable[[Path, ModelKind], tuple[Any, Callable[[], None]]]


def load_native_model(
    path: Path, kind: ModelKind, loader: NativeModelLoader | None = None,
) -> tuple[Any, Callable[[], None]]:
    """Acquire the exact configured model and a release callback.

    A supplied loader owns residency and exclusive-use coordination. Its callback
    releases this operation's lease, not necessarily the model weights. It must not
    share mutable model state between simultaneous operations without proving that
    the backend supports it. The default retains load-per-operation behavior.
    """
    if not path.is_dir():
        raise RuntimeError("The required local model is not installed")
    if loader is not None:
        return loader(path.resolve(), kind)
    import mlx.core as mx
    if kind == "tts":
        from mlx_audio.tts.utils import load_model
    elif kind == "stt":
        from mlx_audio.stt.utils import load_model
    else:
        raise ValueError("Unknown native model kind")
    return load_model(path, strict=True), mx.clear_cache
