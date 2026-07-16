from __future__ import annotations

import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_python_distribution_uses_an_explicit_checkout_allowlist():
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    build = config["tool"]["hatch"]["build"]["targets"]

    assert build["sdist"]["include"] == [
        "/src/meowdiobooks",
        "/frontend/dist",
        "/LICENSE",
        "/README.md",
        "/models.toml",
        "/pyproject.toml",
    ]
    assert "/frontend/node_modules" in build["sdist"]["exclude"]
    assert "/internal-docs" in build["sdist"]["exclude"]
    assert build["wheel"]["force-include"] == {
        "frontend/dist": "meowdiobooks/web",
        "models.toml": "meowdiobooks/resources/models.toml",
    }
