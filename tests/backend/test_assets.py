from pathlib import Path

from meowdiobooks.assets import (
    application_root,
    checkout_root,
    frontend_dist_path,
    model_registry_path,
)


def test_checkout_root_and_registry_resolve_from_the_public_repository():
    root = checkout_root()

    assert root is not None
    assert application_root() == root
    assert model_registry_path(root) == root / "models.toml"


def test_checkout_frontend_build_is_used_when_present(tmp_path):
    compiled = tmp_path / "frontend" / "dist"
    compiled.mkdir(parents=True)

    assert frontend_dist_path(tmp_path) == compiled


def test_explicit_frontend_build_remains_authoritative(tmp_path):
    explicit = tmp_path / "compiled-web"

    assert frontend_dist_path(Path("/unused"), explicit=explicit) == explicit


def test_packaged_asset_fallbacks_are_stable(tmp_path):
    assert frontend_dist_path(tmp_path).parts[-2:] == ("meowdiobooks", "web")
    assert model_registry_path(tmp_path).parts[-3:] == (
        "meowdiobooks",
        "resources",
        "models.toml",
    )
