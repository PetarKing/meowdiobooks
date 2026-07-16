from pathlib import Path

from meowdiobooks.assets import (
    application_root,
    checkout_root,
    frontend_dist_path,
    model_registry_path,
)


def test_checkout_assets_resolve_from_the_public_repository():
    root = checkout_root()

    assert root is not None
    assert application_root() == root
    assert frontend_dist_path(root) == root / "frontend" / "dist"
    assert model_registry_path(root) == root / "models.toml"


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
