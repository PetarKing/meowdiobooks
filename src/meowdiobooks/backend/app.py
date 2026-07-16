"""Production FastAPI entrypoint for the v2 wizard."""

from .app_v2 import create_app_v2

create_app = create_app_v2

__all__ = ["create_app"]
