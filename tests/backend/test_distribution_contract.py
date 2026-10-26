from __future__ import annotations

import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_python_distribution_keeps_mlx_runtime_optional():
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    dependencies = config["project"]["dependencies"]
    runtime = config["project"]["optional-dependencies"]["mlx-runtime"]

    assert "numpy==2.5.1" in dependencies
    assert "scipy==1.18.0" in dependencies
    assert not any(dependency.startswith("mlx-audio") for dependency in dependencies)
    assert "mlx-audio==0.6.1" in runtime
    assert "misaki[en]==0.9.4" in runtime
    assert any(dependency.startswith("en-core-web-sm @ ") for dependency in runtime)


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


def test_workflow_distributions_preserve_the_root_license_and_required_notice():
    terms = (ROOT / "LICENSE").read_bytes()
    assert b"Required Notice: Copyright 2026 Petar Nedeljkovic and Meowdiobooks contributors." in terms
    for relative in ("release/python/LICENSE", "frontend/LICENSE"):
        assert (ROOT / relative).read_bytes() == terms
    config = tomllib.loads((ROOT / "release/python/pyproject.toml").read_text(encoding="utf-8"))
    assert config["project"]["license"] == {"file": "LICENSE"}
