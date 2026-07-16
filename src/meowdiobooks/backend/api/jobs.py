"""Local job HTTP adapter around the reusable queue contract."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from ..models import Book, Job
from ..queue import JobQueue
from ..storage import JsonStore


def create_jobs_router(
    jobs: JsonStore[Job],
    queue: JobQueue,
    require_book: Callable[[str], Book],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/books/{book_id}/jobs")
    def list_book_jobs(book_id: str) -> list[dict[str, object]]:
        try:
            require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return [
            job.model_dump(mode="json")
            for job in sorted(
                (row for row in jobs.all() if row.payload.get("book_id") == book_id),
                key=lambda row: row.created_at,
                reverse=True,
            )
        ]

    @router.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, object]:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job.model_dump(mode="json")

    @router.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict[str, object]:
        try:
            job = queue.cancel(job_id)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job.model_dump(mode="json")

    @router.post("/api/jobs/{job_id}/retry", status_code=202)
    def retry_job(job_id: str) -> dict[str, object]:
        previous = jobs.get(job_id)
        if previous is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if previous.status.value != "failed":
            raise HTTPException(status_code=409, detail="Only failed jobs can be retried")
        job = queue.enqueue(
            previous.kind,
            {key: value for key, value in previous.payload.items() if key != "_job_id"},
            retry_of=previous.id,
            attempt=previous.attempt + 1,
        )
        return job.model_dump(mode="json")

    return router
