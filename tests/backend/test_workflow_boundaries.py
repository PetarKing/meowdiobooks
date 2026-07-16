from pathlib import Path

import pytest
from pydantic import ValidationError

from meowdiobooks.backend.models import WizardStage
from meowdiobooks.backend.workflow.commands import (
    ExtractBook,
    GenerateChapters,
    command_for_stage,
    command_from_job,
)
from meowdiobooks.backend.workflow.runner import WorkflowRunner
from meowdiobooks.backend.workspace import BookWorkspace


def test_stage_commands_validate_and_round_trip_the_existing_job_shape():
    command = command_for_stage("book-1", WizardStage.EXTRACT, {"method": "native"})

    assert isinstance(command, ExtractBook)
    assert command.to_job_payload() == {
        "book_id": "book-1",
        "settings": {"method": "native"},
    }
    assert command_from_job(command.kind, command.to_job_payload()) == command


def test_generation_command_rejects_empty_or_unknown_settings():
    with pytest.raises(ValidationError):
        command_for_stage("book-1", WizardStage.GENERATE, {"chapterIds": []})
    with pytest.raises(ValidationError):
        command_for_stage(
            "book-1", WizardStage.GENERATE, {"chapterIds": ["chapter-1"], "price": 5}
        )


def test_runner_dispatches_a_typed_command_without_queue_or_http_state():
    runner = WorkflowRunner()
    runner.register(
        "v2:generate",
        lambda command, _report: {
            "bookId": command.book_id,
            "chapters": command.settings.chapterIds,
        }
        if isinstance(command, GenerateChapters)
        else {},
    )

    result = runner.run(
        command_for_stage(
            "book-1", WizardStage.GENERATE, {"chapterIds": ["chapter-1"]}
        ),
        lambda _progress, _message=None: None,
    )

    assert result == {"bookId": "book-1", "chapters": ["chapter-1"]}


def test_workspace_publication_invalidates_active_downstream_without_deleting_history(
    tmp_path,
):
    workspace = BookWorkspace.under(tmp_path, "book-1")
    extraction_path, _ = workspace.write_candidate("extraction", {"revision": "e1"})
    dialogue_path, _ = workspace.write_candidate("dialogue", {"revision": "d1"})
    workspace.publish("extraction", extraction_path)
    workspace.publish("dialogue", dialogue_path)

    replacement, _ = workspace.write_candidate("extraction", {"revision": "e2"})
    workspace.publish("extraction", replacement)

    assert workspace.active() == {"extraction": str(replacement)}
    assert [row["revision"] for row in workspace.history("dialogue")] == ["d1"]
    assert workspace.source("book.pdf") == Path(tmp_path) / "packages/book-1/source/book.pdf"
