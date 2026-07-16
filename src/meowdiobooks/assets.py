"""Resolve checkout and installed-package assets through one explicit boundary."""

from __future__ import annotations

from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent


def checkout_root() -> Path | None:
    """Return the public repository root when running from a source checkout."""

    candidate = PACKAGE_ROOT.parents[1]
    source_package = candidate / "src" / "meowdiobooks"
    if source_package.resolve() == PACKAGE_ROOT and (candidate / "pyproject.toml").is_file():
        return candidate
    return None


def application_root() -> Path:
    """Return the root used for user-managed local runtimes and model files."""

    return checkout_root() or Path.cwd()


def frontend_dist_path(
    root: Path | None = None,
    *,
    explicit: Path | str | None = None,
) -> Path:
    """Resolve the compiled local web application without assuming a checkout."""

    if explicit is not None:
        return Path(explicit)
    working_root = root or application_root()
    checkout_dist = working_root / "frontend" / "dist"
    if checkout_dist.is_dir():
        return checkout_dist
    return PACKAGE_ROOT / "web"


def model_registry_path(root: Path | None = None) -> Path:
    """Prefer an explicit checkout registry and otherwise use the packaged default."""

    working_root = root or application_root()
    checkout_registry = working_root / "models.toml"
    if checkout_registry.is_file():
        return checkout_registry
    return PACKAGE_ROOT / "resources" / "models.toml"
