"""Typed commands persisted by the local queue and reusable by future editions."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..models import WizardStage


class CommandModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExtractionSettings(CommandModel):
    method: Literal["liteparse", "native", "layout", "ocr", "text"] = "liteparse"


class RegexProfile(CommandModel):
    id: str | None = None
    label: str | None = None
    pattern: str
    flags: str = "m"
    priority: int | None = None
    enabled: bool | None = None
    builtIn: bool | None = None


class DialogueSettings(CommandModel):
    strategy: Literal["fill-gaps", "narrate"] = "narrate"
    customRegexes: list[RegexProfile] = Field(default_factory=list)
    enabledRegexIds: list[str] | None = None
    openSpeakerLabels: list[str] = Field(default_factory=lambda: ["???"])
    openSpeakerPatterns: list[str] = Field(default_factory=list)
    conflictResolutions: list[dict[str, object]] = Field(default_factory=list)
    structuralResolutions: list[dict[str, object]] = Field(default_factory=list)
    attributionTargets: list[Literal["open-speakers", "unlabelled-candidates"]] = Field(
        default_factory=lambda: ["open-speakers", "unlabelled-candidates"]
    )
    attributionRoute: Literal["local", "remote"] | None = None


class ReviewSettings(CommandModel):
    pass


class SourceVoiceSelection(CommandModel):
    bookId: str = Field(min_length=1, max_length=200)
    characterId: str = Field(min_length=1, max_length=200)
    revision: str = Field(min_length=1, max_length=200)


class CastSettings(CommandModel):
    proposalRevision: str = ""
    forceReclassify: bool = False
    characterId: str = ""
    voiceSettings: dict[str, object] | None = None
    identityDecisions: list[dict[str, object]] | None = None
    voiceModel: str | None = None
    language: str | None = None
    narratorDirection: str | None = None
    sourceBookIds: list[str] = Field(default_factory=list, max_length=100)
    castingPreviewFingerprint: str | None = Field(default=None, max_length=128)
    sourceVoice: SourceVoiceSelection | None = None


class GenerationSettings(CommandModel):
    chapterIds: list[str] = Field(min_length=1)
    language: str | None = None


class WorkflowCommandBase(CommandModel):
    book_id: str = Field(min_length=1)

    def to_job_payload(self) -> dict[str, object]:
        return {
            "book_id": self.book_id,
            "settings": self.settings.model_dump(
                mode="json", by_alias=True, exclude_none=True, exclude_unset=True
            ),
        }


class ExtractBook(WorkflowCommandBase):
    kind: Literal["v2:extract"] = "v2:extract"
    settings: ExtractionSettings = Field(default_factory=ExtractionSettings)


class RunDialogue(WorkflowCommandBase):
    kind: Literal["v2:dialogue"] = "v2:dialogue"
    settings: DialogueSettings = Field(default_factory=DialogueSettings)


class RunReview(WorkflowCommandBase):
    kind: Literal["v2:review"] = "v2:review"
    settings: ReviewSettings = Field(default_factory=ReviewSettings)


class BuildCast(WorkflowCommandBase):
    kind: Literal["v2:cast"] = "v2:cast"
    settings: CastSettings = Field(default_factory=CastSettings)


class GenerateChapters(WorkflowCommandBase):
    kind: Literal["v2:generate"] = "v2:generate"
    settings: GenerationSettings


WorkflowCommand = Annotated[
    ExtractBook | RunDialogue | RunReview | BuildCast | GenerateChapters,
    Field(discriminator="kind"),
]
def command_for_stage(
    book_id: str, stage: WizardStage, settings: dict[str, object]
) -> WorkflowCommand:
    from typing import cast

    from .defaults import PUBLIC_WORKFLOW

    return cast(
        WorkflowCommand,
        PUBLIC_WORKFLOW.command_for_stage(stage.value, book_id, settings),
    )


def command_from_job(kind: str, payload: dict[str, object]) -> WorkflowCommand:
    from typing import cast

    from .defaults import PUBLIC_WORKFLOW

    return cast(WorkflowCommand, PUBLIC_WORKFLOW.command_from_job(kind, payload))
