"""Serve the complete local web application from checkout or packaged assets."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_local_frontend(app: FastAPI, static_root: Path) -> None:
    if not static_root.is_dir():
        return

    @app.get("/library", include_in_schema=False)
    @app.get("/player", include_in_schema=False)
    def frontend_product_view() -> FileResponse:
        return FileResponse(static_root / "index.html")

    app.mount("/", StaticFiles(directory=static_root, html=True), name="frontend")
