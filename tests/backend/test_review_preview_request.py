"""Transcript previews carry the same explicit chapter choices as acceptance."""

import pytest
from pydantic import ValidationError

from meowdiobooks.backend.api.schemas import ReviewTranscriptPreviewRequest


def test_preview_request_preserves_chapter_choices_and_accepts_legacy_callers():
    assert ReviewTranscriptPreviewRequest(revision="r1", page=1).boundaryDecisions == []
    choices = [
        {"boundaryId": "heading-1", "action": "chapter-start"},
        {"boundaryId": "heading-2", "action": "not-a-boundary"},
    ]
    request = ReviewTranscriptPreviewRequest.model_validate({
        "revision": "r1", "page": 1, "boundaryDecisions": choices,
    })
    assert request.model_dump()["boundaryDecisions"] == choices


@pytest.mark.parametrize("choice", [
    {"boundaryId": "", "action": "chapter-start"},
    {"boundaryId": "heading-1", "action": "repair"},
    {"boundaryId": "heading-1", "action": "chapter-start", "extra": True},
])
def test_preview_request_rejects_invalid_chapter_choices(choice):
    with pytest.raises(ValidationError):
        ReviewTranscriptPreviewRequest.model_validate({
            "revision": "r1", "page": 1, "boundaryDecisions": [choice],
        })
