from pathlib import Path

import pytest
from pydantic import ValidationError

from meowdiobooks.backend.artifact_registry import ArtifactSpec, PUBLIC_ARTIFACTS
from meowdiobooks.backend.models import WizardStage
from meowdiobooks.backend.workflow.commands import (
    ExtractBook,
    GenerateChapters,
    command_for_stage,
    command_from_job,
)
from meowdiobooks.backend.workflow.runner import WorkflowRunner
from meowdiobooks.backend.workflow import PUBLIC_WORKFLOW, StageSpec
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
    runner = WorkflowRunner(PUBLIC_WORKFLOW)
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


def test_custom_composition_can_insert_and_remove_an_optional_stage():
    artifacts = PUBLIC_ARTIFACTS.with_spec(
        ArtifactSpec(
            "ambient-plan",
            "example.ambient-plan.v1",
            requires=("cast",),
        )
    )
    definition = PUBLIC_WORKFLOW.with_artifacts(artifacts).insert_after(
        "cast",
        StageSpec(
            "ambient",
            prerequisites=("cast",),
            command_kind="example:ambient",
            command_model=GenerateChapters,
            artifact_kind="ambient-plan",
        ),
    )

    assert definition.stage("ambient").artifact_kind == "ambient-plan"
    assert definition.artifacts.downstream("cast") == (
        "script",
        "ambient-plan",
    )
    assert definition.remove("ambient").stage("generate").id == "generate"


def test_custom_composition_can_replace_a_handler_without_changing_the_stage_contract():
    runner = WorkflowRunner(PUBLIC_WORKFLOW)
    runner.register_stage(
        "generate",
        lambda command, _report: {
            "provider": "custom-handler",
            "bookId": command.book_id,
        },
    )

    result = runner.run(
        command_for_stage(
            "book-1", WizardStage.GENERATE, {"chapterIds": ["chapter-1"]}
        ),
        lambda _progress, _message=None: None,
    )

    assert result == {"provider": "custom-handler", "bookId": "book-1"}


def test_composition_rejects_removing_a_required_stage():
    with pytest.raises(ValueError, match="still required"):
        PUBLIC_WORKFLOW.remove("dialogue")


def test_custom_artifact_registry_preserves_extension_artifacts_and_invalidation(tmp_path):
    artifacts = PUBLIC_ARTIFACTS.with_spec(
        ArtifactSpec(
            "ambient-plan",
            "example.ambient-plan.v1",
            requires=("script",),
        )
    )
    workspace = BookWorkspace.under(tmp_path, "book-custom", artifacts)
    script_path, _ = workspace.write_candidate("script", {"revision": "s1"})
    ambient_path, ambient = workspace.write_candidate(
        "ambient-plan", {"revision": "a1", "events": []}
    )
    workspace.publish("script", script_path)
    workspace.publish("ambient-plan", ambient_path)

    replacement, _ = workspace.write_candidate("script", {"revision": "s2"})
    workspace.publish("script", replacement)

    assert ambient["contract"] == "example.ambient-plan.v1"
    assert workspace.active() == {"script": str(replacement)}


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


def test_public_workflow_goes_directly_from_cast_to_generate():
    assert [stage.id for stage in PUBLIC_WORKFLOW.stages] == [
        "import", "extract", "dialogue", "review", "cast", "generate"
    ]
    assert PUBLIC_WORKFLOW.stage("generate").prerequisites == ("cast",)
    assert PUBLIC_ARTIFACTS.downstream("cast") == ("script",)
    with pytest.raises(ValueError, match="Unknown workflow command"):
        command_from_job("v2:enrich", {"book_id": "book-1", "settings": {"skip": True}})
    with pytest.raises(ValueError):
        PUBLIC_ARTIFACTS.spec("enrichment")
