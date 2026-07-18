from meowdiobooks.backend.app_v2 import _matching_failed_generation_job
from meowdiobooks.backend.models import Job, JobStatus


def test_same_input_generate_click_reuses_latest_failed_job() -> None:
    payload = {
        "book_id": "book-1",
        "chapter_ids": ["chapter-1"],
        "language": "english",
        "workflow_version": "2.0",
    }
    resumable = Job(
        id="attempt-1",
        kind="v2:generate",
        payload={**payload, "_job_id": "attempt-1"},
        status=JobStatus.FAILED,
        attempt=1,
    )
    different_inputs = Job(
        id="attempt-2",
        kind="v2:generate",
        payload={**payload, "chapter_ids": ["chapter-2"]},
        status=JobStatus.FAILED,
        attempt=1,
    )
    succeeded = Job(
        id="attempt-3",
        kind="v2:generate",
        payload=payload,
        status=JobStatus.SUCCEEDED,
        attempt=1,
    )

    assert (
        _matching_failed_generation_job(
            [different_inputs, succeeded, resumable], "v2:generate", payload
        )
        == resumable
    )


def test_changed_generate_inputs_create_a_new_attempt() -> None:
    failed = Job(
        id="attempt-1",
        kind="v2:generate",
        payload={
            "book_id": "book-1",
            "chapter_ids": ["chapter-1"],
            "language": "english",
            "workflow_version": "2.0",
        },
        status=JobStatus.FAILED,
    )

    assert (
        _matching_failed_generation_job(
            [failed],
            "v2:generate",
            {
                "book_id": "book-1",
                "chapter_ids": ["chapter-1"],
                "language": "spanish",
                "workflow_version": "2.0",
            },
        )
        is None
    )
