"""Typed local HTTP requests; workflow semantics live outside FastAPI."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..workflow.commands import RegexProfile


class ApiRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExtractionPreviewRequest(ApiRequest):
    page: int = Field(ge=1)
    method: Literal["liteparse", "native", "layout"] = "liteparse"


class StageProcessRequest(ApiRequest):
    settings: dict[str, object] = Field(default_factory=dict)


class StageAcceptRequest(ApiRequest):
    revision: str = Field(min_length=1)
    decisions: list[dict[str, object]] = Field(default_factory=list)


class M4BChapterRequest(ApiRequest):
    chapterId: str = Field(min_length=1)
    revision: str = Field(min_length=1)


class M4BExportRequest(ApiRequest):
    chapters: list[M4BChapterRequest] = Field(min_length=1)
    title: str | None = Field(default=None, max_length=500)
    author: str | None = Field(default=None, max_length=500)
    coverPage: int = Field(default=1, ge=1)


class DialoguePreviewRequest(ApiRequest):
    customRegexes: list[RegexProfile] = Field(default_factory=list)
    enabledRegexIds: list[str] | None = None
    openSpeakerLabels: list[str] = Field(default_factory=lambda: ["???"])
    openSpeakerPatterns: list[str] = Field(default_factory=list)
    conflictResolutions: list[dict[str, object]] = Field(default_factory=list)
    structuralResolutions: list[dict[str, object]] = Field(default_factory=list)
    attributionTargets: list[Literal["open-speakers", "unlabelled-candidates"]] = Field(
        default_factory=lambda: ["open-speakers", "unlabelled-candidates"]
    )


class ReviewBulkPreviewRequest(ApiRequest):
    revision: str = Field(min_length=1)
    occurrenceId: str = Field(min_length=1)
    action: str = Field(min_length=1)


class ReviewTranscriptPolicyRequest(ApiRequest):
    warningId: str = Field(min_length=1)
    action: str = Field(min_length=1)


class ReviewTranscriptPreviewRequest(ApiRequest):
    revision: str = Field(min_length=1)
    page: int = Field(ge=1)
    policies: list[ReviewTranscriptPolicyRequest] = Field(default_factory=list)
