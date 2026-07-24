"""Read-only local audiobook library routes and operating-system actions."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from ..m4b import FFmpegUnavailableError, M4BExportError, extract_embedded_cover
from ..models import LibraryExport
from ..storage import ModelStore


def create_library_router(
    library: ModelStore[LibraryExport],
    require_export: Callable[[str], tuple[LibraryExport, Path]],
    package_for: Callable[[str], Path],
    payload_for: Callable[..., dict[str, object]],
    export_available: Callable[[LibraryExport], bool] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/library")
    is_available = export_available or (lambda item: Path(item.file_path).is_file())

    @router.get("")
    def list_library_exports() -> list[dict[str, object]]:
        items = [item for item in library.all() if is_available(item)]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return [payload_for(item, package=package_for(item.book_id)) for item in items]

    @router.get("/{export_id}/cover")
    def library_export_cover(export_id: str) -> Response:
        item, path = require_export(export_id)
        if item.cover_path and Path(item.cover_path).is_file():
            return FileResponse(Path(item.cover_path))
        try:
            return Response(content=extract_embedded_cover(path), media_type="image/jpeg")
        except (FFmpegUnavailableError, M4BExportError) as error:
            raise HTTPException(status_code=404, detail="This audiobook has no readable cover") from error

    @router.post("/{export_id}/open", status_code=204)
    def open_library_export(export_id: str) -> Response:
        _item, path = require_export(export_id)
        try:
            subprocess.run(["open", str(path)], check=True, capture_output=True)
        except (OSError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=500, detail="The audiobook could not be opened") from error
        return Response(status_code=204)

    @router.post("/{export_id}/reveal", status_code=204)
    def reveal_library_export(export_id: str) -> Response:
        _item, path = require_export(export_id)
        try:
            subprocess.run(["open", "-R", str(path)], check=True, capture_output=True)
        except (OSError, subprocess.SubprocessError) as error:
            raise HTTPException(
                status_code=500, detail="The audiobook could not be shown in Finder"
            ) from error
        return Response(status_code=204)

    return router
