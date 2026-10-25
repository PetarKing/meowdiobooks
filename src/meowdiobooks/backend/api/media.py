"""Routes that expose immutable local preview and generated media."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

from ..audio import layered_preview_wav
from ..documents import render_pdf_page, source_path
from ..models import Book


def create_media_router(
    root: Path,
    require_book: Callable[[str], Book],
    package_for: Callable[[str], Path],
    *,
    page_renderer: Callable[[Path, Path, int], Path] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/books/{book_id}/pages/{page}/image")
    def page_image(book_id: str, page: int) -> FileResponse:
        try:
            book = require_book(book_id)
            if not book.source_name or not book.page_count or not 1 <= page <= book.page_count:
                raise ValueError("Page not found")
            path = (page_renderer if page_renderer is not None else render_pdf_page)(
                source_path(root, book.id, book.source_name),
                package_for(book.id) / "preview",
                page,
            )
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return FileResponse(path, media_type="image/png")

    @router.get("/books/{book_id}/voices/{character_id}/{revision}/audio")
    def voice_audio(book_id: str, character_id: str, revision: str) -> FileResponse:
        try:
            require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        path = package_for(book_id) / "voices" / character_id / f"{revision}.wav"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Voice audition not found")
        return FileResponse(path, media_type="audio/wav")

    @router.get("/books/{book_id}/voices/layered/audio")
    def layered_voice_audio(book_id: str, member: list[str] = Query(default=[])) -> Response:
        try:
            require_book(book_id)
            parsed: list[tuple[str, str]] = []
            for value in member:
                character_id, separator, revision = value.partition(":")
                if (
                    separator != ":"
                    or not character_id
                    or not revision
                    or any(not (part.isalnum() or part in "-_") for part in character_id)
                    or any(not (part.isalnum() or part in "-_") for part in revision)
                ):
                    raise ValueError("Invalid layered preview voice reference")
                parsed.append((character_id, revision))
            content = layered_preview_wav(package_for(book_id), parsed)
        except (OSError, ValueError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return Response(
            content=content, media_type="audio/wav", headers={"Cache-Control": "no-store"}
        )

    @router.get("/books/{book_id}/chapters/{chapter_id}/{revision}/audio")
    def chapter_audio(book_id: str, chapter_id: str, revision: str) -> FileResponse:
        try:
            require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        path = package_for(book_id) / "audio" / chapter_id / revision / "chapter.wav"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Chapter audio not found")
        return FileResponse(path, media_type="audio/wav")

    @router.post("/books/{book_id}/chapters/{chapter_id}/{revision}/audio/open")
    def open_chapter_audio(book_id: str, chapter_id: str, revision: str) -> Response:
        try:
            require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        path = package_for(book_id) / "audio" / chapter_id / revision / "chapter.wav"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Chapter audio not found")
        try:
            subprocess.run(["open", str(path)], check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError) as error:
            raise HTTPException(status_code=422, detail="Could not open the chapter WAV") from error
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
