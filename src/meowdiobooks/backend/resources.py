"""Minimal local resource safeguards for heavyweight jobs."""

from __future__ import annotations

import shutil
import subprocess
import sys
import os
from pathlib import Path


MINIMUM_FREE_BYTES = 2 * 1024**3


def require_free_disk(root: Path, minimum_free_bytes: int = MINIMUM_FREE_BYTES) -> None:
    """Refuse to begin expensive work without a conservative disk reserve."""
    free = shutil.disk_usage(root).free
    if free < minimum_free_bytes:
        required_gib = minimum_free_bytes / 1024**3
        available_gib = free / 1024**3
        raise RuntimeError(
            f"Insufficient free disk: {available_gib:.1f} GiB available; "
            f"keep at least {required_gib:.1f} GiB free"
        )


class SleepInhibitor:
    """Own a macOS idle-sleep inhibition process for one running job."""

    def __init__(self) -> None:
        self._process: subprocess.Popen[bytes] | None = None

    def __enter__(self) -> SleepInhibitor:
        caffeinate = Path("/usr/bin/caffeinate")
        if sys.platform == "darwin" and caffeinate.is_file():
            self._process = subprocess.Popen(
                [str(caffeinate), "-i", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        if self._process is None:
            return
        self._process.terminate()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait()
