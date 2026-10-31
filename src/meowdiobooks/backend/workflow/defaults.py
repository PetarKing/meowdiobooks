"""The public local-first workflow definition."""

from .commands import (
    BuildCast,
    ExtractBook,
    GenerateChapters,
    RunDialogue,
    RunReview,
)
from .definition import StageSpec, WorkflowDefinition
from ..artifact_registry import PUBLIC_ARTIFACTS


PUBLIC_WORKFLOW = WorkflowDefinition(
    version="meowdiobooks.workflow.v2",
    artifacts=PUBLIC_ARTIFACTS,
    stages=(
        StageSpec("import"),
        StageSpec(
            "extract",
            prerequisites=("import",),
            command_kind="v2:extract",
            command_model=ExtractBook,
            artifact_kind="extraction",
        ),
        StageSpec(
            "dialogue",
            prerequisites=("extract",),
            command_kind="v2:dialogue",
            command_model=RunDialogue,
            artifact_kind="dialogue",
        ),
        StageSpec(
            "review",
            prerequisites=("dialogue",),
            command_kind="v2:review",
            command_model=RunReview,
            artifact_kind="review",
        ),
        StageSpec(
            "cast",
            prerequisites=("review",),
            command_kind="v2:cast",
            command_model=BuildCast,
            artifact_kind="cast",
        ),
        StageSpec(
            "generate",
            prerequisites=("cast",),
            command_kind="v2:generate",
            command_model=GenerateChapters,
        ),
    ),
)
