"""Persisted API models."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class WizardStage(StrEnum):
    IMPORT = "import"
    EXTRACT = "extract"
    DIALOGUE = "dialogue"
    REVIEW = "review"
    CAST = "cast"
    GENERATE = "generate"


class AudioExportPreset(StrEnum):
    M4B_HIGH = "m4b-high"
    M4B_COMPACT = "m4b-compact"
    MP3_CHAPTERS = "mp3-chapters"


class StageRevision(BaseModel):
    stage: WizardStage
    revision: int = Field(ge=1)
    data: dict[str, object] = Field(default_factory=dict)
    accepted_at: datetime = Field(default_factory=utc_now)


class Book(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, max_length=500)
    source_name: str | None = None
    source_kind: str | None = None
    source_hash: str | None = None
    page_count: int | None = Field(default=None, ge=1)
    stage: WizardStage = WizardStage.IMPORT
    accepted_stage_revisions: list[StageRevision] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class BookCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    source_name: str | None = None


class LibraryExport(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    book_id: str
    title: str = Field(min_length=1, max_length=500)
    author: str = Field(max_length=500)
    filename: str
    file_path: str
    chapter_count: int = Field(ge=1)
    chapter_titles: list[str] = Field(default_factory=list)
    chapter_positions: list[int] = Field(default_factory=list)
    partial: bool = False
    size_bytes: int = Field(ge=1)
    preset: AudioExportPreset = AudioExportPreset.M4B_HIGH
    media_type: str = "audio/mp4"
    cover_path: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class StageUpdate(BaseModel):
    stage: WizardStage
    data: dict[str, object] = Field(default_factory=dict)
    expected_revision: int | None = Field(default=None, ge=0)


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    CANCELED = "canceled"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class Job(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    kind: str = Field(min_length=1)
    payload: dict[str, object] = Field(default_factory=dict)
    status: JobStatus = JobStatus.QUEUED
    result: dict[str, object] | None = None
    error: str | None = None
    progress: float = Field(default=0, ge=0, le=100)
    message: str | None = None
    cancel_requested_at: datetime | None = None
    attempt: int = Field(default=1, ge=1)
    retry_of: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class JobCreate(BaseModel):
    kind: str = Field(min_length=1)
    payload: dict[str, object] = Field(default_factory=dict)


class ChapterRevision(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    book_id: str
    chapter_id: str
    revision: int = Field(ge=1)
    status: str
    artifact_path: str | None = None
    settings: dict[str, object] = Field(default_factory=dict)
    metrics: dict[str, object] = Field(default_factory=dict)
    job_id: str | None = None
    input_fingerprint: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
