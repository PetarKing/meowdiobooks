"""Read-only setup diagnostics for a complete local Meowdiobooks workflow."""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .assets import frontend_dist_path, model_registry_path
from .backend.model_config import ModelConfigError, asset_path, load_model_registry


@dataclass(frozen=True)
class Check:
    ok: bool
    label: str
    detail: str
    required: bool = True


def doctor(repo_root: Path) -> list[Check]:
    """Inspect the host and configured assets without installing or changing anything."""

    checks = [
        Check(platform.system() == "Darwin", "macOS", platform.platform()),
        Check(platform.machine() == "arm64", "Apple Silicon", platform.machine()),
        Check(
            sys.version_info[:2] == (3, 12),
            "Python 3.12",
            platform.python_version(),
        ),
    ]
    for executable, install in (
        ("uv", "brew install uv"),
        ("node", "brew install node"),
        ("npm", "brew install node"),
        ("pdftoppm", "brew install poppler"),
        ("liteparse", "npm install --global @llamaindex/liteparse"),
        ("ffmpeg", "brew install ffmpeg"),
    ):
        found = shutil.which(executable)
        checks.append(Check(found is not None, executable, found or install))
    checks.append(
        Check(
            importlib.util.find_spec("mlx_audio") is not None,
            "Python dependencies",
            "mlx-audio is importable" if importlib.util.find_spec("mlx_audio") else "run uv sync --all-groups",
        )
    )
    frontend = frontend_dist_path(repo_root) / "index.html"
    checks.append(
        Check(
            frontend.is_file(),
            "Frontend build",
            str(frontend) if frontend.is_file() else "run npm --prefix frontend run build",
        )
    )
    checks.extend(_model_checks(repo_root))
    checks.extend(_capacity_checks(repo_root))
    return checks


def print_doctor(repo_root: Path) -> int:
    checks = doctor(repo_root)
    for check in checks:
        marker = "ok" if check.ok else "missing" if check.required else "warning"
        print(f"[{marker}] {check.label}: {check.detail}")
    missing = sum(not check.ok and check.required for check in checks)
    print(f"\n{'Setup is ready.' if not missing else f'{missing} required check(s) failed.'}")
    return 0 if not missing else 1


def _model_checks(repo_root: Path) -> list[Check]:
    try:
        registry = load_model_registry(repo_root)
    except ModelConfigError as error:
        return [Check(False, "Model configuration", str(error))]
    checks = [Check(True, "Model configuration", str(model_registry_path(repo_root)))]
    text = registry.active_text_model()
    runtime = asset_path(repo_root, text.runtime_path)
    model = asset_path(repo_root, text.model_path)
    checks.extend(
        [
            Check(
                runtime.is_file() and os.access(runtime, os.X_OK),
                f"Text runtime ({text.label})",
                str(runtime),
            ),
            Check(model.is_file(), f"Text model ({text.label})", str(model)),
        ]
    )
    for pipeline in registry.voice_pipelines.values():
        audition = asset_path(repo_root, pipeline.audition_path)
        renderer = asset_path(repo_root, pipeline.renderer_path)
        checks.append(
            Check(audition.is_dir(), f"Voice auditions ({pipeline.label})", str(audition))
        )
        checks.append(
            Check(renderer.is_dir(), f"Voice renderer ({pipeline.label})", str(renderer))
        )
        if audition.is_dir() and renderer.is_dir():
            checks.append(_language_check(pipeline.label, pipeline.languages, audition, renderer))
    if registry.default_transcription_id is not None:
        speech = registry.transcription_model()
        model = asset_path(repo_root, speech.model_path)
        checks.append(Check(model.is_dir(), f"Speech recognition ({speech.label})", str(model)))
    return checks


def _language_check(
    label: str, declared: tuple[str, ...], audition: Path, renderer: Path
) -> Check:
    try:
        audition_languages = _model_languages(audition / "config.json")
        renderer_languages = _model_languages(renderer / "config.json")
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return Check(False, f"Voice languages ({label})", str(error))
    unsupported = sorted(set(declared) - audition_languages | set(declared) - renderer_languages)
    return Check(
        not unsupported,
        f"Voice languages ({label})",
        (
            f"{len(declared)} configured languages verified"
            if not unsupported
            else "not supported by both configured models: " + ", ".join(unsupported)
        ),
    )


def _model_languages(path: Path) -> set[str]:
    config = json.loads(path.read_text(encoding="utf-8"))
    language_ids = config["talker_config"]["codec_language_id"]
    return {str(value).casefold() for value in language_ids if "dialect" not in str(value)}


def _capacity_checks(repo_root: Path) -> list[Check]:
    checks: list[Check] = []
    free_bytes = shutil.disk_usage(repo_root).free
    checks.append(
        Check(
            free_bytes >= 30 * 1024**3,
            "Free storage",
            f"{free_bytes / 1024**3:.1f} GB available; 30 GB recommended",
            required=False,
        )
    )
    try:
        memory = int(
            subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout.strip()
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        checks.append(
            Check(
                False,
                "Unified memory",
                "could not read hw.memsize; verify 18 GB manually",
                required=False,
            )
        )
    else:
        checks.append(
            Check(
                memory >= 18 * 1024**3,
                "Unified memory",
                f"{memory / 1024**3:.1f} GB detected; 18 GB recommended",
                required=False,
            )
        )
    return checks
