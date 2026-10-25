"""Clean-break FastAPI integration for the complete v2 wizard."""

from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from contextlib import AbstractContextManager, ExitStack, asynccontextmanager, nullcontext
from copy import deepcopy
from datetime import UTC
from pathlib import Path
from typing import Any, Callable, Mapping, cast
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from meowdiobooks.assets import application_root, frontend_dist_path
from meowdiobooks.util import atomic_write

from .artifacts import (
    ARTIFACT_KINDS,
    active_artifacts,
    artifact_history,
    read_artifact,
    write_artifact,
)
from .api.schemas import (
    AudioExportRequest,
    CastingPreviewRequest,
    DialoguePreviewRequest,
    ExtractionPreviewRequest,
    ReviewBulkPreviewRequest,
    ReviewTranscriptPreviewRequest,
    StageAcceptRequest,
    StageProcessRequest,
)
from .api.jobs import create_jobs_router
from .action_required import action_required_http_exception
from .api.library import create_library_router
from .api.media import create_media_router
from .api.static import mount_local_frontend
from .audio import (
    VOICE_SAMPLE_SUFFIXES,
    generate_cast_previews,
    generate_cloned_audition,
    normalize_voice_sample,
)
from .cast import (
    CastContractError,
    cast_progression_blockers,
    finalize_identity_mapping,
)
from .voice_reuse import (
    CastVoiceReuse,
    validated_imported_voices,
    validate_source_book_ids,
    validate_cast_proposal_inputs,
)
from .cast_runtime import (
    _apply_cast_line_counts,
    _audition_character,
    _audition_identity,
    _audition_line,
    _cast_with_line_counts,
    cast_voice_targets,
    _expand_cast_label_mapping,
    _has_complete_audition_pack,
    _rebase_accepted_cast,
    _reuse_unchanged_cast_voices,
    _shared_audition_identity,
)
from .cast_service import (
    compile_voice_direction,
    default_voice_settings,
    propose_cast,
    suggest_voice_settings,
    validate_audition_line,
    validate_voice_settings,
)
from .chapters import ChapterContractError, compile_reviewed_chapters, detect_chapter_candidates
from .dialogue import (
    DialogueContractError,
    dialogue_progression_blockers,
    dialogue_recovery,
    pages_to_dialogue_blocks,
    scan_dialogue,
    validate_dialogue_partition,
)
from .dialogue_ai import apply_dialogue_corrections, run_dialogue_qwen
from .dialogue_remote import run_dialogue_remote
from .documents import (
    EXTRACTION_METHOD_VERSION,
    extract_full_document,
    extract_pdf_page,
    imported_book_id,
    inspect_source,
    pdf_metadata,
    render_pdf_page,
    representative_pages,
    source_path,
)
from .generation_status import chapter_audio_stale_reasons, generated_chapters
from .file_processing import FileProcessor
from .models import (
    AudioExportPreset,
    Book,
    Job,
    JobStatus,
    LibraryExport,
    StageRevision,
    WizardStage,
    utc_now,
)
from .model_config import dialogue_routing_preview, load_model_registry
from .voice_candidates import VoiceCandidatePolicy
from .remote_llm import RemoteRequestAdmission, RemoteUsageObserver
from .m4b import (
    FFmpegUnavailableError,
    M4BChapter,
    M4BExportError,
    audio_export_profile,
    embedded_chapter_titles,
    export_filename,
    package_audio_export,
)
from .languages import (
    infer_language,
    normalize_language,
    shared_audition_line,
    supported_voice_languages,
    voice_model_capabilities,
)
from .queue import JobFailureReporter, JobQueue
from .errors import WorkflowInputError, public_error_message
from .resources import SleepInhibitor, require_free_disk
from .voice_retention import cast_voice_revisions, prune_voice_files
from .voice_sharing import VoiceSharingPolicy, plan_shared_voices
from .voice_profile_checkpoint import (
    profile_checkpoint_key,
    read_profile_checkpoint,
    write_profile_checkpoint,
)
from .review import (
    ReviewContractError,
    add_cleanup_proposals,
    accept_review_revision,
    apply_review_render_policies,
    build_review_workspace,
    preview_bulk_decision,
    preview_review_transcript_page,
)
from .render_plan import compile_render_plan
from .recording_script import (
    RecordingScriptContractError,
    build_recording_script,
    recording_script_matches,
    split_recording_script_chapter,
)
from .storage import JsonStore, ModelStore
from .tts_v2 import render_plan_audio
from .transcription import TranscriptionDraft, transcribe_voice_sample
from .workflow.commands import (
    BuildCast,
    ExtractBook,
    GenerateChapters,
    RunDialogue,
    RunReview,
    command_for_stage,
)
from .workflow.runner import WorkflowRunner
from .workflow.runtime import commit_publication
from .workflow.defaults import PUBLIC_WORKFLOW
from .workspace import BookWorkspace

logger = logging.getLogger(__name__)


def _commit_library_export(
    item: LibraryExport,
    *,
    audio_source: Path,
    cover_source: Path,
    audio_destination: Path,
    cover_destination: Path,
    library: ModelStore[LibraryExport],
    on_library_exported: Callable[[LibraryExport, Path, Path], None] | None,
    retain_local: bool,
) -> None:
    """Publish an export, then evict local copies only after all durable commits succeed."""

    temporary_audio = audio_destination.with_name(
        f".{audio_destination.name}.{uuid4().hex}.tmp"
    )
    temporary_cover = cover_destination.with_name(
        f".{cover_destination.name}.{uuid4().hex}.tmp"
    )
    try:
        shutil.copy2(audio_source, temporary_audio)
        shutil.copy2(cover_source, temporary_cover)
        os.replace(temporary_audio, audio_destination)
        os.replace(temporary_cover, cover_destination)
        if on_library_exported is not None:
            on_library_exported(item, audio_destination, cover_destination)
        library.put(item)
    except (OSError, RuntimeError):
        temporary_audio.unlink(missing_ok=True)
        temporary_cover.unlink(missing_ok=True)
        audio_destination.unlink(missing_ok=True)
        cover_destination.unlink(missing_ok=True)
        raise

    if retain_local:
        return
    for path in (audio_destination, cover_destination):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not evict committed Library artifact %s", path)


def _directory_size(path: Path) -> int:
    """Return the on-disk bytes owned by one working-book package."""
    total = 0

    def walk_error(error: OSError) -> None:
        # A hosted book can have durable files without a hydrated local workspace.
        if not isinstance(error, FileNotFoundError):
            raise error

    for directory, _subdirectories, filenames in os.walk(path, onerror=walk_error):
        for filename in filenames:
            try:
                total += os.stat(Path(directory) / filename, follow_symlinks=False).st_size
            except FileNotFoundError:
                # Concurrent cleanup can remove a file after directory enumeration.
                continue
    return total


_STAGE_KIND = {
    WizardStage.EXTRACT: "extraction",
    WizardStage.DIALOGUE: "dialogue",
    WizardStage.REVIEW: "review",
    WizardStage.CAST: "cast",
}
# Backward-compatible test seam; new code imports the projection by its public name.
_generated_chapters = generated_chapters
_MAX_VOICE_SAMPLE_BYTES = 25_000_000
ChapterAudioSource = Callable[[str, str, str, Path], AbstractContextManager[Path]]


def _voice_candidates_for(voice: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep legacy single-preview Cast rows in the editable audition collection."""

    candidates = [
        deepcopy(row)
        for row in voice.get("voiceCandidates", [])
        if isinstance(row, dict) and row.get("revision")
    ]
    if candidates or not voice.get("voicePreviewRevision"):
        return candidates
    return [{
        "revision": voice["voicePreviewRevision"],
        "previewUrl": voice.get("previewUrl"),
        "referenceText": voice.get("referenceText"),
        "referenceAudio": voice.get("referenceAudio"),
        "referenceMode": voice.get("referenceMode"),
        "direction": voice.get("voiceDirection"),
        "voiceSettings": deepcopy(voice.get("voiceSettings")),
    }]


def _append_voice_auditions(
    target: dict[str, Any], updated: dict[str, Any]
) -> dict[str, Any]:
    """Append new revisions without allowing an adapter to rewrite earlier auditions."""

    candidates = _voice_candidates_for(target)
    known = {str(row["revision"]) for row in candidates}
    for row in _voice_candidates_for(updated):
        revision = str(row["revision"])
        if revision in known:
            continue
        row["parentRevision"] = candidates[-1]["revision"] if candidates else None
        candidates.append(row)
        known.add(revision)
    return {**updated, "voiceCandidates": candidates}


def _validate_voice_audio(
    package: Path, character_id: str, candidate: dict[str, Any]
) -> None:
    """Require exact, nonempty local preview/reference files before committing metadata."""

    revision = str(candidate.get("voicePreviewRevision") or candidate.get("revision") or "")
    if not revision or any(not (letter.isalnum() or letter in "-_") for letter in revision):
        raise CastContractError("Voice audition has an invalid revision")
    if not candidate.get("previewUrl"):
        raise CastContractError("Voice audition has no playable preview")
    mode = str(candidate.get("referenceMode") or "transcript-conditioned")
    if mode not in {"transcript-conditioned", "speaker-embedding"}:
        raise CastContractError("Voice audition has an unsupported reference mode")
    if mode == "transcript-conditioned" and not str(candidate.get("referenceText") or "").strip():
        raise CastContractError("Voice audition has no reference transcript")
    reference_relative = candidate.get("referenceAudio") or Path("voices") / character_id / f"{revision}.wav"
    reference = (package / str(reference_relative)).resolve()
    voices = (package / "voices").resolve()
    if (
        voices not in reference.parents
        or reference.name not in {f"{revision}.wav", f"{revision}.reference.wav"}
    ):
        raise CastContractError("Voice audition reference does not match its revision")
    preview = reference.with_name(f"{revision}.wav")
    for audio in {preview, reference}:
        if not audio.is_file() or not audio.stat().st_size:
            raise CastContractError("Voice audition audio is missing or empty")


def _require_current_voice_draft(package: Path, revision: str) -> None:
    history = artifact_history(package, "cast")
    if not history or str(history[-1].get("revision")) != revision:
        raise WorkflowInputError(
            "The Voice draft changed. Refresh before adding or removing auditions",
            public_message="The voice draft changed. Refresh before adding or removing auditions.",
        )


def _generate_voice_candidates(
    *,
    voice_auditioner: Callable[..., list[dict[str, Any]]],
    repo_root: Path,
    package: Path,
    book_id: str,
    characters: list[dict[str, Any]],
    report: Callable[[float, str | None], None],
    language: str,
    model_id: str,
    policy: VoiceCandidatePolicy,
) -> list[dict[str, Any]]:
    """Generate the baseline cast, then reroll only the configured high-volume voices."""

    selected_ids = set(policy.selected_ids(characters))
    for character in characters:
        character_id = str(character.get("id") or character.get("characterId") or "")
        character["voiceCandidatePlan"] = {
            "automaticAlternatives": (
                policy.extra_candidates if character_id in selected_ids else 0
            ),
            "shared": bool(character.get("sharedVoiceGroupId")),
        }
    passes = 1 + (policy.extra_candidates if selected_ids else 0)

    def pass_report(index: int) -> Callable[[float, str | None], None]:
        return lambda progress, message=None: report(
            (index + max(0.0, min(100.0, progress)) / 100) / passes * 100,
            message,
        )

    generated = voice_auditioner(
        repo_root,
        package,
        book_id,
        characters,
        pass_report(0),
        language,
        model_id,
    )
    for index in range(policy.extra_candidates):
        reroll = [
            row
            for row in generated
            if str(row.get("id") or row.get("characterId") or "") in selected_ids
        ]
        if not reroll:
            break
        updated = voice_auditioner(
            repo_root,
            package,
            book_id,
            reroll,
            pass_report(index + 1),
            language,
            model_id,
        )
        by_id = {
            str(row.get("id") or row.get("characterId") or ""): row
            for row in updated
        }
        generated = [
            by_id.get(str(row.get("id") or row.get("characterId") or ""), row)
            for row in generated
        ]
    return generated


def _voice_sharing_policy_for_model(
    model_id: str,
    default_policy: VoiceSharingPolicy,
    resolver: Callable[[str], VoiceSharingPolicy | None] | None,
) -> VoiceSharingPolicy | None:
    """Resolve optional model-specific sharing without replacing an explicit ``None``."""

    return resolver(model_id) if resolver is not None else default_policy


def _voice_recipe_version(models: list[dict[str, Any]], model_id: str) -> str:
    """Resolve the current whole-pack recipe version for one selectable voice model."""

    model = next((row for row in models if str(row.get("id", "")) == model_id), None)
    if model is None:
        raise CastContractError(f"Unknown voice model: {model_id}")
    version = str(model.get("recipeVersion", "")).strip()
    if not version:
        raise CastContractError(f"Voice model {model_id} does not declare a recipe version")
    return version


def create_app_v2(
    data_dir: Path | str = Path(".meowdiobooks"),
    frontend_dist: Path | str | None = None,
    library_dir: Path | str | None = None,
    *,
    voice_auditioner: Callable[..., list[dict[str, Any]]] | None = None,
    voice_sample_auditioner: Callable[..., bytes] | None = None,
    voice_sample_transcriber: Callable[..., TranscriptionDraft] | None = None,
    chapter_renderer: Callable[..., list[dict[str, Any]]] | None = None,
    cast_proposer: Callable[..., dict[str, Any]] | None = None,
    voice_profiler: Callable[..., dict[str, dict[str, str]]] | None = None,
    cast_voice_reuse: CastVoiceReuse | None = None,
    voice_profiler_revision: str = "meowdiobooks.voice-profile.v2",
    generate_voice_audition_lines: bool = False,
    remote_usage_observer: RemoteUsageObserver | None = None,
    remote_request_admission: RemoteRequestAdmission | None = None,
    cleanup_reviewer: Callable[..., dict[str, Any]] | None = None,
    cleanup_usage_observer: RemoteUsageObserver | None = None,
    cleanup_request_admission: RemoteRequestAdmission | None = None,
    voice_languages: Callable[[Path, str], list[str]] | None = None,
    voice_models: Callable[[Path], list[dict[str, Any]]] | None = None,
    default_voice_model: str | None = None,
    voice_sharing_policy: VoiceSharingPolicy | None = None,
    voice_sharing_policy_for_model: (
        Callable[[str], VoiceSharingPolicy | None] | None
    ) = None,
    voice_candidate_policy: Mapping[str, Any] | VoiceCandidatePolicy | None = None,
    store_factory: Callable[[str, type[Any]], ModelStore[Any]] | None = None,
    book_id_for_source: Callable[[str], str] | None = None,
    on_book_imported: Callable[[Book, Path], None] | None = None,
    on_book_deleting: Callable[[Book], None] | None = None,
    on_library_exported: Callable[[LibraryExport, Path, Path], None] | None = None,
    library_export_available: Callable[[LibraryExport], bool] | None = None,
    retain_local_library_exports: bool = True,
    chapter_audio_source: ChapterAudioSource | None = None,
    job_preflight: Callable[[], None] | None = None,
    on_job_failed: JobFailureReporter | None = None,
    on_operation_failed: Callable[[str, str | None, Exception], None] | None = None,
    file_processor: FileProcessor | None = None,
    on_cast_voice_revisions_changed: (
        Callable[[Path, frozenset[str]], None] | None
    ) = None,
) -> FastAPI:
    """Create the v2 API with explicit provider seams for local or hosted composition.

    The optional import identity resolver receives the verified source SHA-256 and returns a stable,
    path-safe book ID within the host's store. Local imports retain their content-derived ID.
    The post-import hook observes an already-persisted book. Raising from the hook removes the new
    book and source so the same bytes can be retried as a fresh import. The pre-delete hook runs
    after active-work checks and before local state is removed; raising aborts deletion so hosted
    compositions can retry durable cleanup. Chapter audio is local and durable by default; hosted
    compositions may provide a context-managed source that materializes an exact revision only
    while an export consumes it. Local Library files are retained by default. Object-backed
    compositions may provide an availability resolver and disable local export retention after
    their export hook and model store both commit successfully.
    """

    root = Path(data_dir)
    if not retain_local_library_exports and on_library_exported is None:
        raise ValueError(
            "Disabling local Library retention requires a durable export hook"
        )
    repo_root = application_root()
    voice_auditioner = voice_auditioner or generate_cast_previews
    voice_sample_auditioner = voice_sample_auditioner or _local_voice_sample_auditioner
    voice_sample_transcriber = voice_sample_transcriber or _local_voice_sample_transcriber
    chapter_renderer = chapter_renderer or render_plan_audio
    cast_proposer = cast_proposer or propose_cast
    voice_profiler = voice_profiler or suggest_voice_settings
    if not voice_profiler_revision.strip():
        raise ValueError("Voice-profiler revision must not be blank")
    voice_languages = voice_languages or supported_voice_languages
    voice_models = voice_models or voice_model_capabilities
    chapter_audio_source = chapter_audio_source or (
        lambda _book_id, _chapter_id, _revision, expected: nullcontext(expected)
    )
    retain_cast_voice_revisions = (
        on_cast_voice_revisions_changed or prune_voice_files
    )
    registry = load_model_registry(repo_root)
    default_voice_id = default_voice_model or registry.default_voice_id
    voice_sharing_policy = voice_sharing_policy or VoiceSharingPolicy()
    if isinstance(voice_candidate_policy, VoiceCandidatePolicy):
        resolved_voice_candidate_policy = voice_candidate_policy
    else:
        resolved_voice_candidate_policy = VoiceCandidatePolicy.from_mapping(
            voice_candidate_policy
        ) if voice_candidate_policy is not None else registry.voice_candidate_policy
    books = cast(
        ModelStore[Book],
        store_factory("books", Book) if store_factory else JsonStore(root / "books.json", Book),
    )
    jobs = cast(
        ModelStore[Job],
        store_factory("jobs", Job) if store_factory else JsonStore(root / "jobs.json", Job),
    )
    library = cast(
        ModelStore[LibraryExport],
        store_factory("library", LibraryExport)
        if store_factory
        else JsonStore(root / "library.json", LibraryExport),
    )
    library_root = Path(library_dir) if library_dir is not None else root / "library"
    library_cover_root = root / "library-covers"
    queue = JobQueue(
        jobs,
        before_run=lambda _job: (
            job_preflight() if job_preflight is not None else require_free_disk(root)
        ),
        activity=SleepInhibitor,
        on_job_failed=on_job_failed,
    )
    runner = WorkflowRunner(PUBLIC_WORKFLOW)

    def report_operation_failure(operation: str, book_id: str | None, error: Exception) -> None:
        if on_operation_failed is None:
            logger.error(
                "Workflow operation failed: operation=%s book_id=%s", operation, book_id,
                exc_info=(type(error), error, error.__traceback__),
            )
            return
        try:
            on_operation_failed(operation, book_id, error)
        except Exception:
            logger.error(
                "Workflow failure reporter failed: operation=%s book_id=%s", operation, book_id,
            )

    def require_book(book_id: str) -> Book:
        book = books.get(book_id)
        if book is None:
            raise ValueError("Book not found")
        return book

    def package_for(book_id: str) -> Path:
        return workspace_for(book_id).root

    def workspace_for(book_id: str) -> BookWorkspace:
        return BookWorkspace.under(root, book_id)

    def write_cast_candidate(
        package: Path, payload: dict[str, Any]
    ) -> tuple[Path, dict[str, Any]]:
        history = artifact_history(package, "cast")
        previous = history[-1] if history else {}
        path, artifact = write_artifact(package, "cast", payload, publish=False)
        keep = set(cast_voice_revisions(artifact))
        keep.update(cast_voice_revisions(previous))
        try:
            keep.update(cast_voice_revisions(read_artifact(package, "cast")))
        except ValueError:
            pass
        try:
            retain_cast_voice_revisions(package, frozenset(keep))
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return path, artifact

    def current_voice_recipe_version(model_id: str) -> str:
        return _voice_recipe_version(voice_models(repo_root), model_id)

    def cast_with_recipe_freshness(payload: dict[str, Any]) -> dict[str, Any]:
        if not payload or payload.get("phase") == "identity-review":
            return payload
        model_id = str(payload.get("voiceModel") or default_voice_id)
        current_version = current_voice_recipe_version(model_id)
        return {
            **payload,
            "auditionPackRefreshRequired": (
                str(payload.get("auditionPackRecipeVersion", "")) != current_version
            ),
        }

    def require_library_export(export_id: str) -> tuple[LibraryExport, Path]:
        item = library.get(export_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Audiobook not found in Library")
        path = Path(item.file_path)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="This audiobook was moved or deleted")
        return item, path

    def extraction_payload(book_id: str) -> dict[str, Any]:
        return read_artifact(package_for(book_id), "extraction")

    def dialogue_scan_settings(settings: dict[str, Any]) -> dict[str, Any]:
        return {
            "custom_profiles": list(settings.get("customRegexes", [])),
            "enabled_profile_ids": settings.get("enabledRegexIds"),
            "open_speaker_literals": list(settings.get("openSpeakerLabels", ["???"])),
            "open_speaker_patterns": list(settings.get("openSpeakerPatterns", [])),
            "conflict_resolutions": list(settings.get("conflictResolutions", [])),
            "structural_resolutions": list(settings.get("structuralResolutions", [])),
        }

    def process_extraction(command: ExtractBook, report) -> dict[str, object]:
        book = require_book(command.book_id)
        if not book.source_name or book.source_kind != "pdf":
            raise ValueError("Extraction requires an imported PDF")
        source = source_path(root, book.id, book.source_name)
        digest = hashlib.sha256()
        with source.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        if not book.source_hash or digest.hexdigest() != book.source_hash:
            raise WorkflowInputError(
                "Imported source integrity check failed; re-import the PDF",
                public_message="Import the source document again before continuing.",
            )
        method = command.settings.method
        report(2, "Extracting the complete PDF")
        package = package_for(book.id)
        pages = (file_processor.extract_full_document if file_processor is not None else extract_full_document)(
            source,
            package / "preview",
            method,
            report,
        )
        blocks = pages_to_dialogue_blocks(pages)
        boundary_candidates = detect_chapter_candidates(blocks)
        revision = uuid4().hex
        path, artifact = write_artifact(
            package,
            "extraction",
            {
                "revision": revision,
                "method": method,
                "methodVersion": EXTRACTION_METHOD_VERSION,
                "sourceHash": book.source_hash,
                "pageCount": len(pages),
                "pages": pages,
                "blocks": blocks,
                "boundaryCandidates": boundary_candidates,
                "warnings": [
                    {**warning, "page": page["page"]}
                    for page in pages
                    for warning in page.get("warnings", [])
                    if isinstance(warning, dict)
                ],
            },
            publish=False,
        )
        report(100, "Extraction candidate ready for review")
        return _candidate_result(book.id, WizardStage.EXTRACT, path, artifact)

    def process_dialogue(command: RunDialogue, report) -> dict[str, object]:
        book = require_book(command.book_id)
        extraction = extraction_payload(book.id)
        settings = command.settings.model_dump(
            mode="json", exclude_none=True, exclude_unset=True
        )
        strategy = str(settings.get("strategy", "narrate"))
        report(5, "Checking dialogue formats")
        scan = scan_dialogue(extraction["blocks"], **dialogue_scan_settings(settings))
        blockers = dialogue_progression_blockers(scan)
        if blockers:
            raise WorkflowInputError(
                "; ".join(blockers),
                public_message="Review the dialogue rules and resolve conflicting matches before continuing.",
            )
        attribution_targets = list(
            settings.get("attributionTargets", ["open-speakers", "unlabelled-candidates"])
        )
        if strategy == "narrate":
            from .dialogue_ai import resolve_dialogue

            result = resolve_dialogue(scan, strategy, lambda *_args: "", attribution_targets)
        elif strategy == "fill-gaps":
            route = str(
                settings.get(
                    "attributionRoute",
                    load_model_registry(repo_root).dialogue_attribution.default_route,
                )
            )
            if route == "local":
                report(15, "Using AI to identify speakers from nearby text")
                result = run_dialogue_qwen(
                    repo_root, scan, strategy, report, attribution_targets
                )
                result["attributionRoute"] = "local"
            elif route == "remote":
                report(15, "Preparing the remote speaker check")
                result = run_dialogue_remote(
                    repo_root,
                    scan,
                    strategy,
                    report,
                    attribution_targets,
                    usage_observer=remote_usage_observer,
                    request_admission=remote_request_admission,
                )
            else:
                raise DialogueContractError(f"Unknown Dialogue attribution route: {route}")
        else:
            raise DialogueContractError(f"Unknown Dialogue strategy: {strategy}")
        validate_dialogue_partition(result)
        revision = uuid4().hex
        path, artifact = write_artifact(
            package_for(book.id),
            "dialogue",
            {
                **result,
                "revision": revision,
                "extractionRevision": extraction["revision"],
                "spans": result["partition"],
                "settings": settings,
            },
            publish=False,
        )
        report(100, "Dialogue candidate ready for result review")
        return _candidate_result(book.id, WizardStage.DIALOGUE, path, artifact)

    def process_review(command: RunReview, report) -> dict[str, object]:
        book = require_book(command.book_id)
        extraction = extraction_payload(book.id)
        dialogue = read_artifact(package_for(book.id), "dialogue")
        report(1, "Checking the transcript for issues")
        workspace = build_review_workspace(extraction, dialogue)
        if workspace.get("recovery") is None:
            from .cleanup_remote import run_cleanup_review

            cleanup = (cleanup_reviewer or run_cleanup_review)(
                repo_root, extraction, dialogue, report,
                usage_observer=cleanup_usage_observer,
                request_admission=cleanup_request_admission,
            )
            workspace = add_cleanup_proposals(workspace, extraction, dialogue, cleanup)
        revision = uuid4().hex
        path, artifact = write_artifact(
            package_for(book.id),
            "review",
            {
                **workspace,
                "revision": revision,
                "status": "candidate",
                "boundaryCandidates": extraction.get("boundaryCandidates", []),
            },
            publish=False,
        )
        report(100, "Review warnings ready")
        return _candidate_result(book.id, WizardStage.REVIEW, path, artifact)

    def process_cast(command: BuildCast, report) -> dict[str, object]:
        package = package_for(command.book_id)
        history = artifact_history(package, "cast")
        keep = set(cast_voice_revisions(history[-1] if history else {}))
        try:
            keep.update(cast_voice_revisions(read_artifact(package, "cast")))
        except ValueError:
            pass
        try:
            return build_cast_candidate(command, report)
        except Exception:
            # A successful upload may have advanced the draft while this provider was busy.
            current_history = artifact_history(package, "cast")
            keep.update(cast_voice_revisions(current_history[-1] if current_history else {}))
            try:
                keep.update(cast_voice_revisions(read_artifact(package, "cast")))
            except ValueError:
                pass
            try:
                retain_cast_voice_revisions(package, frozenset(keep))
            except Exception:
                logger.exception("Could not clean up an unsuccessful Cast audition")
            raise

    def build_cast_candidate(command: BuildCast, report) -> dict[str, object]:
        book = require_book(command.book_id)
        package = package_for(book.id)
        dialogue = read_artifact(package, "dialogue")
        review = read_artifact(package, "review")
        settings = command.settings.model_dump(
            mode="json", exclude_none=True, exclude_unset=True
        )
        proposal_revision = str(settings.get("proposalRevision", ""))
        force_reclassify = settings.get("forceReclassify") is True
        if proposal_revision and force_reclassify:
            raise CastContractError("Cast reclassification cannot reuse an existing proposal")
        revision = uuid4().hex

        def finish(payload: dict[str, Any], message: str, voice_base: str = ""):
            def publish() -> dict[str, object]:
                validate_cast_proposal_inputs(
                    payload, read_artifact(package, "dialogue"), read_artifact(package, "review")
                )
                if voice_base:
                    _require_current_voice_draft(package, voice_base)
                path, artifact = write_cast_candidate(package, payload)
                return _candidate_result(book.id, WizardStage.CAST, path, artifact)

            return commit_publication(report, publish, message)

        if not proposal_revision:
            reusable = None
            if not force_reclassify:
                reusable = _rebase_accepted_cast(
                    package,
                    dialogue_revision=str(dialogue["revision"]),
                    review_revision=str(review["revision"]),
                    revision=revision,
                    voice_recipe_version_for_model=current_voice_recipe_version,
                    default_voice_model=default_voice_id,
                )
            if reusable is not None:
                narrator_count = _apply_cast_line_counts(
                    reusable, reusable,
                    apply_review_render_policies(dialogue, review).get("spans", []),
                )
                if not narrator_count:
                    reusable["narrator"] = None
                elif isinstance(reusable.get("narrator"), dict):
                    reusable["narrator"]["lineCount"] = narrator_count
                if not narrator_count or reusable.get("narrator"):
                    return finish(reusable, "Existing cast and auditions ready for review")
            report(2, "Building contextual identity dossiers")
            spans = list(dialogue.get("spans", []))
            extraction = read_artifact(package, "extraction")
            proposal = (
                cast_proposer(repo_root, spans, report)
                if any(
                    row.get("sourceSpeakerLabel") or row.get("resolvedSpeakerLabel")
                    for row in spans
                )
                else {
                    "status": "ready",
                    "dossiers": [],
                    "fuzzyCandidates": [],
                    "globalLabelLedger": "",
                    "proposals": [],
                    "reconciliationConflicts": [],
                    "processing": {"labels": 0, "batches": 0, "model": "not-required"},
                }
            )
            body = {
                **proposal,
                "detectedLanguage": infer_language(list(extraction.get("pages", []))),
                "revision": revision,
                "phase": "identity-review",
                "dialogueRevision": dialogue["revision"],
                "reviewRevision": review["revision"],
            }
        else:
            proposal = _candidate(package, "cast", proposal_revision)
            validate_cast_proposal_inputs(proposal, dialogue, review)
            phase = str(proposal.get("phase", ""))
            if phase not in {"identity-review", "audition-review"}:
                raise CastContractError("Auditions require an editable Cast candidate")
            character_id = str(settings.get("characterId", ""))
            if character_id:
                if phase != "audition-review":
                    raise CastContractError(
                        "Generate the cast auditions before regenerating one voice"
                    )
                _require_current_voice_draft(package, proposal_revision)
                model_id = str(proposal.get("voiceModel", default_voice_id))
                language = normalize_language(proposal.get("language", "english"))
                current_recipe_version = current_voice_recipe_version(model_id)
                if str(proposal.get("auditionPackRecipeVersion", "")) != current_recipe_version:
                    raise CastContractError(
                        "The audition recipe changed; regenerate the complete audition pack first"
                    )
                rows = [proposal.get("narrator"), *proposal.get("identities", [])]
                target = next(
                    (
                        row
                        for row in rows
                        if isinstance(row, dict) and str(row.get("characterId")) == character_id
                    ),
                    None,
                )
                if target is None:
                    raise CastContractError("Cast voice not found")
                if settings.get("sourceVoice"):
                    if cast_voice_reuse is None:
                        raise CastContractError("Voice reuse is unavailable")
                    report(2, "Reusing the selected voice")
                    updated = validated_imported_voices({character_id: cast_voice_reuse.import_voice(
                        book.id, package, deepcopy(target), settings["sourceVoice"], language, model_id,
                    )}, [target])[character_id]
                    updated = _append_voice_auditions(target, updated)
                    known = {row["revision"] for row in _voice_candidates_for(target)}
                    candidates = _voice_candidates_for(updated)
                    if updated.get("voicePreviewRevision") not in {row["revision"] for row in candidates}:
                        raise CastContractError("Imported voice did not return a selectable revision")
                    for row in candidates:
                        if row["revision"] not in known:
                            _validate_voice_audio(package, character_id, row)
                    body = {
                        **proposal, "revision": revision, "phase": "audition-review",
                        "status": "needs-voice-review",
                        "narrator": updated if character_id == "narrator" else proposal.get("narrator"),
                        "identities": [updated if str(row.get("characterId")) == character_id else row
                                       for row in proposal.get("identities", [])],
                    }
                    return finish(body, "Reused voice ready for review", proposal_revision)
                character = {
                    **deepcopy(target),
                    "id": character_id,
                    "voiceCandidates": _voice_candidates_for(target),
                    "voiceSettings": validate_voice_settings(
                        settings.get("voiceSettings")
                        or target.get("voiceSettings")
                        or {
                            **default_voice_settings(str(target.get("category", "character"))),
                            "description": str(target.get("voiceDirection") or ""),
                        },
                        fallback_category=str(target.get("category", "character")),
                    ),
                }
                for key in (
                    "acceptedVoiceRevision",
                    "previewUrl",
                    "referenceAudio",
                    "referenceMode",
                    "referenceText",
                    "voicePreviewRevision",
                    "voiceRevision",
                ):
                    character.pop(key, None)
                try:
                    character["previewLine"] = validate_audition_line(
                        target.get("auditionLine")
                    )
                except CastContractError:
                    character["previewLine"] = _audition_line(
                        str(target.get("name", character_id)), language
                    )
                character["voiceDirection"] = compile_voice_direction(
                    character["voiceSettings"], language=language
                )
                report(2, f"Regenerating the {target.get('name', character_id)} audition")
                generated_rows = voice_auditioner(
                    repo_root, package, book.id, [character], report, language, model_id
                )
                if not isinstance(generated_rows, list) or len(generated_rows) != 1 or not isinstance(generated_rows[0], dict):
                    raise CastContractError("Voice audition did not return one cast voice")
                generated = generated_rows[0]
                if str(generated.get("id") or generated.get("characterId")) != character_id:
                    raise CastContractError("Voice audition returned a different cast identity")
                updated = _append_voice_auditions(
                    target, _audition_identity(generated, package, base=target)
                )
                known = {row["revision"] for row in _voice_candidates_for(target)}
                added = [row for row in _voice_candidates_for(updated) if row["revision"] not in known]
                if not added or updated.get("voicePreviewRevision") not in {row["revision"] for row in added}:
                    raise CastContractError("Voice audition did not return a new selectable revision")
                for row in added:
                    _validate_voice_audio(package, character_id, row)
                identities = [
                    updated if str(row.get("characterId")) == character_id else row
                    for row in proposal.get("identities", [])
                ]
                body = {
                    **proposal,
                    "revision": revision,
                    "phase": "audition-review",
                    "status": "needs-voice-review",
                    "narrator": updated if character_id == "narrator" else proposal.get("narrator"),
                    "identities": identities,
                }
                return finish(body, "Voice audition ready for review", proposal_revision)

            raw_decisions = settings.get("identityDecisions", proposal.get("identityDecisions", []))
            if not isinstance(raw_decisions, list):
                raise CastContractError("Identity decisions must be a list")
            decisions = {
                str(row.get("label", "")): row
                for row in raw_decisions
                if isinstance(row, dict) and row.get("label")
            }
            finalized = finalize_identity_mapping(proposal.get("proposals", []), decisions)
            _expand_cast_label_mapping(finalized, proposal)
            narrator_line_count = _apply_cast_line_counts(
                finalized, proposal, apply_review_render_policies(dialogue, review).get("spans", [])
            )
            model_id = str(settings.get("voiceModel", proposal.get("voiceModel", default_voice_id)))
            language = normalize_language(
                settings.get("language", proposal.get("language", "english"))
            )
            if not language or language not in voice_languages(repo_root, model_id):
                raise CastContractError(
                    "Select a language supported by the selected voice-audition model"
                )
            current_recipe_version = current_voice_recipe_version(model_id)
            same_language = (
                phase == "audition-review"
                and language == normalize_language(proposal.get("language", "english"))
            )
            same_selection = (
                same_language
                and model_id == str(proposal.get("voiceModel", default_voice_id))
            )
            recipe_is_current = (
                str(proposal.get("auditionPackRecipeVersion", "")) == current_recipe_version
            )
            matched = _reuse_unchanged_cast_voices(finalized, proposal) if same_language else {}
            reused: dict[str, dict[str, Any]] = {}
            for character_id, row in matched.items():
                route = row.get("voiceRoute")
                if (
                    same_selection
                    and isinstance(route, dict)
                    and route.get("kind") == "layered"
                ):
                    layered = deepcopy(row)
                    for key in (
                        "acceptedVoiceRevision",
                        "previewUrl",
                        "referenceAudio",
                        "referenceMode",
                        "referenceText",
                        "voiceCandidates",
                        "voicePreviewRevision",
                        "voiceRevision",
                    ):
                        layered.pop(key, None)
                    reused[character_id] = layered
                elif (
                    ((same_selection and recipe_is_current)
                     or row.get("reusedVoiceSnapshot") is True)
                    and _has_complete_audition_pack(row)
                ):
                    reused[character_id] = row
            source_book_ids = validate_source_book_ids(
                settings.get("sourceBookIds", proposal.get("sourceBookIds", [])), book.id
            )
            imported = {}
            reuse_selection_unchanged = (
                same_selection
                and source_book_ids == proposal.get("sourceBookIds", [])
            )
            if source_book_ids and not reuse_selection_unchanged:
                if cast_voice_reuse is None:
                    raise CastContractError("Voice reuse is unavailable")
                report(1, "Matching voices from selected books")
                targets = cast_voice_targets(finalized, proposal, dialogue, review)
                imported = validated_imported_voices(
                    cast_voice_reuse.apply(
                        book.id, package, targets, source_book_ids, language, model_id,
                        **({"preview_fingerprint": settings["castingPreviewFingerprint"]}
                           if settings.get("castingPreviewFingerprint") else {}),
                    ),
                    targets,
                )
                matched.update({key: row for key, row in imported.items() if key != "narrator"})
                reused.update({key: row for key, row in imported.items() if key != "narrator"})
            affected = [
                row
                for row in finalized["identities"]
                if str(row["characterId"]) not in reused
            ]
            profile_targets = [
                row
                for row in finalized["identities"]
                if str(row["characterId"]) not in matched
            ]
            include_narrator_profile = (
                narrator_line_count > 0
                and (not same_language or not proposal.get("narrator"))
                and "narrator" not in imported
            )
            profiles: dict[str, dict[str, str]] = {}
            if profile_targets or include_narrator_profile:
                checkpoint_key = profile_checkpoint_key(
                    proposal_revision=proposal_revision,
                    dialogue_revision=str(dialogue.get("revision", "")),
                    review_revision=str(review.get("revision", "")),
                    identities=profile_targets,
                    language=language,
                    profiler_revision=voice_profiler_revision,
                    include_narrator=include_narrator_profile,
                    generate_audition_lines=generate_voice_audition_lines,
                )
                expected_profile_ids = {
                    str(row["characterId"]) for row in profile_targets
                }
                if include_narrator_profile:
                    expected_profile_ids.add("narrator")
                restored_profiles = read_profile_checkpoint(
                    package,
                    checkpoint_key,
                    expected_character_ids=expected_profile_ids,
                )
                if restored_profiles is not None:
                    profiles = restored_profiles
                    report(28, "Reusing unchanged voice suggestions")
                else:
                    voice_profiler_kwargs: dict[str, Any] = {
                        "include_narrator": include_narrator_profile,
                    }
                    if generate_voice_audition_lines:
                        voice_profiler_kwargs.update(
                            {
                                "generate_audition_line": True,
                                "language": language,
                            }
                        )
                    profiles = voice_profiler(
                        repo_root,
                        profile_targets,
                        proposal.get("dossiers", []),
                        dialogue.get("spans", []),
                        lambda progress, message=None: report(
                            2 + progress * 0.28, message
                        ),
                        **voice_profiler_kwargs,
                    )
                    for row in profile_targets:
                        character_id = str(row["characterId"])
                        profiles.setdefault(
                            character_id,
                            default_voice_settings(
                                str(row.get("category", "character"))
                            ),
                        )
                    if include_narrator_profile:
                        profiles.setdefault(
                            "narrator", default_voice_settings("narrator")
                        )
                    write_profile_checkpoint(package, checkpoint_key, profiles)
            for row in profile_targets:
                character_id = str(row["characterId"])
                profile = profiles.get(character_id) or default_voice_settings(
                    str(row.get("category", "character"))
                )
                desired_settings = validate_voice_settings(
                    profile,
                    fallback_category=str(row.get("category", "character")),
                )
                row["voiceSettings"] = deepcopy(desired_settings)
                row["voiceDirection"] = compile_voice_direction(
                    desired_settings, language=language
                )
                try:
                    row["auditionLine"] = validate_audition_line(
                        profile.get("auditionLine")
                    )
                except CastContractError:
                    row.pop("auditionLine", None)
            for row in finalized["identities"]:
                previous = matched.get(str(row["characterId"]))
                if previous is None:
                    continue
                try:
                    row["auditionLine"] = validate_audition_line(
                        previous.get("auditionLine")
                    )
                except CastContractError:
                    row.pop("auditionLine", None)
            desired_settings_by_id = {
                str(row["characterId"]): row.get("voiceSettings", {})
                for row in finalized["identities"]
            }
            desired_settings_by_id.update(
                {
                    character_id: row.get("voiceSettings", {})
                    for character_id, row in matched.items()
                }
            )
            selected_sharing_policy = _voice_sharing_policy_for_model(
                model_id,
                voice_sharing_policy,
                voice_sharing_policy_for_model,
            )
            if selected_sharing_policy is None:
                shared_group_by_id = {}
            else:
                sharing_plan = plan_shared_voices(
                    finalized["identities"],
                    desired_settings_by_id,
                    _dialogue_with_chapters(dialogue, review).get("spans", []),
                    finalized.get("labelToCharacterId", {}),
                    selected_sharing_policy,
                    shareable_character_ids={
                        str(row["characterId"]) for row in affected
                    },
                )
                shared_group_by_id = sharing_plan.group_by_character_id
            characters = []
            affected_by_id = {
                str(row["characterId"]): row for row in affected
            }
            for row in affected:
                character_id = str(row["characterId"])
                group = shared_group_by_id.get(character_id)
                if group is not None and character_id != group.character_ids[0]:
                    continue
                character = _audition_character(
                    row, desired_settings_by_id[character_id], language=language
                )
                if group is not None:
                    character.update(
                        {
                            "sharedVoiceGroupId": group.id,
                            "name": f"Supporting voice {group.id.rsplit('-', 1)[-1]}",
                            "previewLine": shared_audition_line(language),
                            "lineCount": sum(
                                int(affected_by_id[member_id].get("lineCount", 0))
                                for member_id in group.character_ids
                                if member_id in affected_by_id
                            ),
                        }
                    )
                characters.append(character)
            previous_narrator = imported.get("narrator") or proposal.get("narrator")
            reusable_narrator = "narrator" in imported or (
                isinstance(previous_narrator, dict)
                and ((same_selection and recipe_is_current)
                     or (same_language and previous_narrator.get("reusedVoiceSnapshot") is True))
                and _has_complete_audition_pack(previous_narrator)
            )
            if narrator_line_count and not reusable_narrator:
                narrator_profile = (
                    deepcopy(previous_narrator.get("voiceSettings"))
                    if same_language
                    and isinstance(previous_narrator, dict)
                    and isinstance(previous_narrator.get("voiceSettings"), dict)
                    else profiles.get("narrator", default_voice_settings("narrator"))
                )
                narrator_settings = validate_voice_settings(
                    narrator_profile, fallback_category="narrator"
                )
                narrator_line_source = (
                    previous_narrator
                    if same_language and isinstance(previous_narrator, dict)
                    else narrator_profile
                )
                try:
                    narrator_audition_line = validate_audition_line(
                        narrator_line_source.get("auditionLine")
                    )
                except CastContractError:
                    narrator_audition_line = None
                narrator_line = narrator_audition_line or _audition_line(
                    "Narrator", language
                )
                characters.insert(
                    0,
                    {
                        "id": "narrator",
                        "name": "Narrator",
                        "category": "narrator",
                        "lineCount": narrator_line_count,
                        "voiceSettings": narrator_settings,
                        "voiceDirection": compile_voice_direction(
                            narrator_settings, language=language
                        ),
                        "previewLine": narrator_line,
                        **(
                            {"auditionLine": narrator_audition_line}
                            if narrator_audition_line is not None
                            else {}
                        ),
                    },
                )
            if characters:
                report(2, f"Generating {len(characters)} affected voice auditions")
                generated = _generate_voice_candidates(
                    voice_auditioner=voice_auditioner,
                    repo_root=repo_root,
                    package=package,
                    book_id=book.id,
                    characters=characters,
                    report=lambda progress, message=None: report(
                        30 + progress * 0.70, message
                    ),
                    language=language,
                    model_id=model_id,
                    policy=resolved_voice_candidate_policy,
                )
            else:
                report(90, "Cast labels updated; all existing auditions remain valid")
                generated = []
            by_id = {str(row["id"]): row for row in generated}
            if not narrator_line_count:
                narrator = None
            elif reusable_narrator:
                assert isinstance(previous_narrator, dict)
                narrator = {
                    **previous_narrator,
                    "name": "Narrator",
                    "category": "narrator",
                    "lineCount": narrator_line_count,
                }
            else:
                narrator = _audition_identity(by_id.pop("narrator"), package)
            body = {
                **proposal,
                **finalized,
                "revision": revision,
                "phase": "audition-review",
                "status": "needs-voice-review",
                "language": language,
                "voiceModel": model_id,
                "auditionPackRecipeVersion": current_recipe_version,
                "auditionPackRefreshRequired": False,
                "narrator": narrator,
                "identities": [
                    reused.get(str(row["characterId"]))
                    or (
                        _shared_audition_identity(
                            by_id[shared_group_by_id[str(row["characterId"])].character_ids[0]],
                            row,
                            shared_group_by_id[str(row["characterId"])].id,
                            package,
                        )
                        if str(row["characterId"]) in shared_group_by_id
                        else _audition_identity(
                            by_id[str(row["characterId"])], package, base=row
                        )
                    )
                    for row in finalized["identities"]
                ],
                "identityDecisions": raw_decisions,
                "sourceBookIds": source_book_ids,
            }
        return finish(body, "Cast candidate ready for review")

    def ensure_recording_script(book_id: str) -> dict[str, Any]:
        """Return the current cached script, rebuilding only when accepted inputs changed."""

        book = require_book(book_id)
        package = package_for(book.id)
        active = active_artifacts(package)
        dialogue = read_artifact(package, "dialogue")
        review = read_artifact(package, "review")
        cast = read_artifact(package, "cast")
        rendered_dialogue = _dialogue_with_chapters(dialogue, review)
        if "script" in active:
            cached = read_artifact(package, "script")
            if recording_script_matches(cached, rendered_dialogue, review, cast):
                return cached
        script = build_recording_script(
            rendered_dialogue,
            review,
            cast,
            revision=uuid4().hex,
        )
        path, script = write_artifact(package, "script", script, publish=False)
        _publish_with_invalidation(package, "script", path)
        return script

    def process_generation(command: GenerateChapters, report) -> dict[str, object]:
        book = require_book(command.book_id)
        package = package_for(book.id)
        settings = command.settings.model_dump(
            mode="json", exclude_none=True, exclude_unset=True
        )
        dialogue = read_artifact(package, "dialogue")
        review = read_artifact(package, "review")
        cast = read_artifact(package, "cast")
        recording_script = ensure_recording_script(book.id)
        chapter_ids = [str(value) for value in settings.get("chapterIds", [])]
        report(1, "Preparing the selected chapters")
        plan = compile_render_plan(
            _dialogue_with_chapters(dialogue, review),
            cast,
            recording_script,
            chapter_ids,
        )
        results = chapter_renderer(
            repo_root,
            package,
            book.id,
            plan,
            str(settings.get("language") or cast.get("language") or "english"),
            report,
            str(cast.get("voiceModel") or default_voice_id),
        )
        prior = [row for row in book.accepted_stage_revisions if row.stage == WizardStage.GENERATE]
        book.accepted_stage_revisions.append(
            StageRevision(
                stage=WizardStage.GENERATE,
                revision=(prior[-1].revision if prior else 0) + 1,
                data={
                    "chapters": [
                        {
                            "chapterId": row["chapterId"],
                            "revision": row["revision"],
                        }
                        for row in results
                    ],
                    "inputRevisions": plan["inputRevisions"],
                },
            )
        )
        book.stage = WizardStage.GENERATE
        book.updated_at = utc_now()
        books.put(book)
        return {"bookId": book.id, "renderPlan": plan, "chapters": results}

    for stage_id, handler in {
        "extract": process_extraction,
        "dialogue": process_dialogue,
        "review": process_review,
        "cast": process_cast,
        "generate": process_generation,
    }.items():
        runner.register_stage(stage_id, handler)
    for command_kind in PUBLIC_WORKFLOW.command_kinds:
        queue.register(command_kind, runner.job_handler(command_kind))

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        queue.start()
        yield
        queue.stop()

    app = FastAPI(title="Meowdiobooks v2", version="2.0.0", lifespan=lifespan)
    app.state.books = books
    app.state.jobs = jobs
    app.state.job_queue = queue
    app.state.workflow_runner = runner
    app.state.workflow_definition = PUBLIC_WORKFLOW
    import_lock = asyncio.Lock()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "pipeline": "v2"}

    @app.post("/api/books/import", status_code=status.HTTP_201_CREATED)
    async def import_book(file: UploadFile = File(...)) -> dict[str, Any]:
        filename = Path(file.filename or "").name
        if Path(filename).suffix.casefold() != ".pdf":
            raise HTTPException(status_code=415, detail="Use a PDF")
        chunks: list[bytes] = []
        total = 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > 500_000_000:
                raise HTTPException(status_code=413, detail="Book exceeds the 500 MB limit")
            chunks.append(chunk)
        raw = b"".join(chunks)
        # Parsing yields to other requests. Serialize import validation and commit
        # within this app so duplicate uploads cannot overwrite an existing book.
        async with import_lock:
            return await finish_import(raw, filename)

    async def finish_import(raw: bytes, filename: str) -> dict[str, Any]:
        book_id, source_hash = imported_book_id(raw)
        if book_id_for_source is not None:
            book_id = book_id_for_source(source_hash)
            if not isinstance(book_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", book_id):
                raise RuntimeError("Import identity resolver returned an invalid book ID")
        existing = books.get(book_id)
        if existing is not None:
            if existing.source_hash != source_hash:
                raise HTTPException(status_code=409, detail="The import identity belongs to another source")
            if not existing.source_name:
                raise HTTPException(
                    status_code=409, detail="The existing import has no source receipt"
                )
            canonical = source_path(root, existing.id, existing.source_name)
            if not canonical.is_file():
                raise HTTPException(status_code=409, detail="The existing imported PDF is missing")
            digest = hashlib.sha256()
            with canonical.open("rb") as stream:
                while stored_chunk := stream.read(1024 * 1024):
                    digest.update(stored_chunk)
            if not existing.source_hash or digest.hexdigest() != existing.source_hash:
                raise HTTPException(
                    status_code=409,
                    detail="The existing imported PDF failed its integrity check",
                )
            return {
                "book": {
                    **existing.model_dump(mode="json"),
                    "asset_size_bytes": _directory_size(package_for(existing.id)),
                },
                "duplicate": True,
                "representativePages": representative_pages(existing.page_count or 1),
            }
        target = source_path(root, book_id, filename)
        created = not target.exists()
        if created:
            atomic_write(target, raw)
        try:
            source_kind, page_count = await run_in_threadpool(
                file_processor.inspect_source if file_processor is not None else inspect_source, target,
            )
            metadata = await run_in_threadpool(
                file_processor.pdf_metadata if file_processor is not None else pdf_metadata, target,
            )
        except (OSError, ValueError) as error:
            if created:
                target.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=str(error)) from error
        book = Book(
            id=book_id,
            title=metadata.get("title") or Path(filename).stem,
            author=metadata.get("author"),
            source_name=filename,
            source_kind=source_kind,
            source_hash=source_hash,
            page_count=page_count,
            accepted_stage_revisions=[
                StageRevision(
                    stage=WizardStage.IMPORT,
                    revision=1,
                    data={"sourceName": filename, "sourceHash": source_hash},
                )
            ],
        )
        try:
            books.put(book)
            if on_book_imported is not None:
                on_book_imported(book, target)
        except BaseException:
            books.delete(book.id)
            if created:
                target.unlink(missing_ok=True)
            raise
        return {
            "book": {
                **book.model_dump(mode="json"),
                "asset_size_bytes": _directory_size(package_for(book.id)),
            },
            "duplicate": False,
            "representativePages": representative_pages(page_count or 1),
        }

    @app.get("/api/books")
    def list_books() -> list[dict[str, Any]]:
        result = []
        for book in sorted(
            books.all(),
            key=lambda row: row.updated_at.replace(tzinfo=UTC)
            if row.updated_at.tzinfo is None
            else row.updated_at,
            reverse=True,
        ):
            try:
                size = _directory_size(package_for(book.id))
            except (OSError, ValueError):
                # Workspace failures belong to this book; store-wide failures above
                # still propagate so an unavailable store is never an empty shelf.
                logger.warning("Skipping book with inaccessible workspace")
                continue
            result.append({**book.model_dump(mode="json"), "asset_size_bytes": size})
        return result

    @app.delete("/api/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_book(book_id: str) -> Response:
        try:
            book = require_book(book_id)
        except (OSError, ValueError) as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        active_jobs = [
            row
            for row in jobs.all()
            if row.payload.get("book_id") == book_id
            and row.status in {JobStatus.QUEUED, JobStatus.RUNNING}
        ]
        if active_jobs:
            raise HTTPException(
                status_code=409,
                detail="Wait for this book's processing to finish or cancel it before deleting.",
            )
        if on_book_deleting is not None:
            try:
                on_book_deleting(book)
            except Exception as error:
                raise HTTPException(
                    status_code=500,
                    detail="Could not remove this book's stored working files.",
                ) from error
        package = package_for(book_id)
        try:
            if package.exists():
                shutil.rmtree(package)
        except OSError as error:
            raise HTTPException(
                status_code=500,
                detail="Could not remove this book's working files.",
            ) from error
        jobs.delete_where(lambda row: row.payload.get("book_id") == book_id)
        books.delete(book_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/books/{book_id}")
    def get_book(book_id: str) -> dict[str, Any]:
        try:
            return require_book(book_id).model_dump(mode="json")
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/api/books/{book_id}/snapshot")
    def snapshot(book_id: str) -> dict[str, Any]:
        try:
            book = require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        package = package_for(book_id)
        active = active_artifacts(package)
        current = {}
        for kind in ("extraction", "dialogue", "review", "cast", "script"):
            if kind in active:
                current[kind] = read_artifact(package, kind)
        dialogue = current.get("dialogue", {})
        review = current.get("review", {})
        accepted_revisions: dict[str, set[str]] = {kind: set() for kind in ARTIFACT_KINDS}
        for receipt in book.accepted_stage_revisions:
            kind = _STAGE_KIND.get(receipt.stage)
            revision = receipt.data.get("artifactRevision")
            if kind is not None and revision is not None:
                accepted_revisions[kind].add(str(revision))
        dialogue_warnings = {
            "conflicts": dialogue.get("conflicts", []),
            "unresolved": [
                span
                for span in dialogue.get("spans", [])
                if span.get("speakerStatus") in {"unresolved", "unlabelled"}
            ],
        }
        review_warnings = review.get("warningSnapshot", review.get("warnings", []))
        active_extraction_revision = str(current.get("extraction", {}).get("revision") or "")
        extraction_history = artifact_history(package, "extraction")
        active_extraction_index = next(
            (
                index
                for index in range(len(extraction_history) - 1, -1, -1)
                if str(extraction_history[index].get("revision") or "")
                == active_extraction_revision
            ),
            -1,
        )
        pending_extraction = next(
            (
                row
                for row in reversed(extraction_history[active_extraction_index + 1 :])
                if str(row.get("revision") or "") not in accepted_revisions["extraction"]
                and book.source_hash
                and row.get("sourceHash") == book.source_hash
            ),
            None,
        )
        dialogue_history = artifact_history(package, "dialogue")
        active_dialogue_revision = str(dialogue.get("revision") or "")
        active_dialogue_index = next(
            (
                index
                for index in range(len(dialogue_history) - 1, -1, -1)
                if str(dialogue_history[index].get("revision") or "") == active_dialogue_revision
            ),
            -1,
        )
        pending_dialogue = next(
            (
                row
                for row in reversed(dialogue_history[active_dialogue_index + 1 :])
                if str(row.get("revision") or "") not in accepted_revisions["dialogue"]
                and str(row.get("extractionRevision") or "") == active_extraction_revision
            ),
            None,
        )
        active_review_revision = str(review.get("revision") or "")
        review_history = artifact_history(package, "review")
        active_review_index = next(
            (
                index
                for index in range(len(review_history) - 1, -1, -1)
                if str(review_history[index].get("revision") or "") == active_review_revision
            ),
            -1,
        )
        pending_review = next(
            (
                row
                for row in reversed(review_history[active_review_index + 1 :])
                if str(row.get("revision") or "") not in accepted_revisions["review"]
                and active_extraction_revision
                and active_dialogue_revision
                and str(row.get("extractionRevision") or "") == active_extraction_revision
                and str(row.get("dialogueRevision") or "") == active_dialogue_revision
            ),
            None,
        )
        cast_history = artifact_history(package, "cast")
        active_cast_revision = str(current.get("cast", {}).get("revision") or "")
        active_cast_index = next(
            (
                index
                for index in range(len(cast_history) - 1, -1, -1)
                if str(cast_history[index].get("revision") or "") == active_cast_revision
            ),
            -1,
        )
        pending_cast = next(
            (
                row
                for row in reversed(cast_history[active_cast_index + 1 :])
                if str(row.get("revision") or "") not in accepted_revisions["cast"]
                and str(row.get("dialogueRevision") or "") == active_dialogue_revision
                and str(row.get("reviewRevision") or "") == active_review_revision
                and row.get("phase") in {"identity-review", "audition-review"}
            ),
            None,
        )
        visible_cast = cast_with_recipe_freshness(
            _cast_with_line_counts(current.get("cast") or pending_cast or {}, dialogue, review)
        )
        recoverable_stages = _recoverable_stages(jobs.all(), book.id)
        malformed_dialogue_recovery = dialogue_recovery(dialogue)
        return {
            "book": book.model_dump(mode="json"),
            "activeArtifacts": {kind: row.get("revision") for kind, row in current.items()},
            "pendingCandidates": {
                **(
                    {"extraction": _history_summary(pending_extraction)}
                    if pending_extraction is not None
                    else {}
                ),
                **(
                    {"review": _history_summary(pending_review)}
                    if pending_review is not None
                    else {}
                ),
                **(
                    {"dialogue": _history_summary(pending_dialogue)}
                    if pending_dialogue is not None
                    else {}
                ),
                **({"cast": _history_summary(pending_cast)} if pending_cast is not None else {}),
            },
            "dialogue": dialogue,
            "dialogueRecovery": malformed_dialogue_recovery,
            "dialogueWarnings": dialogue_warnings,
            "reviewWarnings": review_warnings,
            "reviewInspection": {
                "decisions": review.get("decisions", []),
                "boundaryDecisions": review.get("boundaryDecisions", []),
                "consequences": review.get("consequencePreview", {}),
                "history": [
                    _history_summary(
                        row,
                        active_revision=str(review.get("revision") or ""),
                        accepted_revisions=accepted_revisions["review"],
                    )
                    for row in artifact_history(package, "review")
                ],
            },
            "cast": visible_cast,
            "castingPreviewAvailable": cast_voice_reuse is not None,
            "voiceModels": voice_models(repo_root),
            "voiceSelection": {
                "modelId": visible_cast.get("voiceModel") or default_voice_id,
                "language": visible_cast.get("language"),
            },
            "recoverableStages": recoverable_stages,
            "recordingScript": current.get("script", {}),
            "chapters": current.get("script", {}).get("chapters")
            or review.get("chapters", []),
            "generatedChapters": generated_chapters(
                package,
                {
                    "dialogue": current.get("dialogue", {}).get("revision"),
                    "review": current.get("review", {}).get("revision"),
                    "cast": current.get("cast", {}).get("revision"),
                    "script": current.get("script", {}).get("revision"),
                },
            ),
            "history": {
                kind: [
                    _history_summary(
                        row,
                        active_revision=str(current.get(kind, {}).get("revision") or ""),
                        accepted_revisions=accepted_revisions[kind],
                    )
                    for row in artifact_history(package, kind)
                ]
                for kind in ("extraction", "dialogue", "review", "cast", "script")
            },
        }

    @app.post("/api/books/{book_id}/recording-script/prepare")
    def prepare_recording_script(book_id: str) -> dict[str, Any]:
        try:
            return ensure_recording_script(book_id)
        except ValueError as error:
            status_code = 404 if str(error) == "Book not found" else 409
            raise HTTPException(status_code=status_code, detail=str(error)) from error

    @app.post("/api/books/{book_id}/recording-script/chapters/{chapter_id}/split")
    def split_recording_script(book_id: str, chapter_id: str) -> dict[str, Any]:
        try:
            book = require_book(book_id)
            package = package_for(book.id)
            dialogue = read_artifact(package, "dialogue")
            review = read_artifact(package, "review")
            cast = read_artifact(package, "cast")
            script = ensure_recording_script(book.id)
            split = split_recording_script_chapter(
                script,
                _dialogue_with_chapters(dialogue, review),
                cast,
                chapter_id=chapter_id,
                revision=uuid4().hex,
                chapters=review.get("chapters", []),
            )
            path, split = write_artifact(package, "script", split, publish=False)
            _publish_with_invalidation(package, "script", path)
            return split
        except ValueError as error:
            status_code = 404 if str(error) == "Book not found" else 409
            raise HTTPException(status_code=status_code, detail=str(error)) from error

    @app.get("/api/books/{book_id}/extraction/representative-pages")
    def extraction_representatives(book_id: str) -> list[dict[str, Any]]:
        try:
            book = require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return representative_pages(book.page_count or 1)

    @app.post("/api/books/{book_id}/extraction/preview")
    def extraction_preview(book_id: str, body: ExtractionPreviewRequest) -> dict[str, Any]:
        try:
            book = require_book(book_id)
            if not book.source_name or not book.page_count or body.page > book.page_count:
                raise ValueError("Page is outside this document")
            source = source_path(root, book.id, book.source_name)
            result = (file_processor.extract_pdf_page if file_processor is not None else extract_pdf_page)(
                source, package_for(book.id) / "preview", body.page, body.method
            )
            (file_processor.render_pdf_page if file_processor is not None else render_pdf_page)(
                source, package_for(book.id) / "preview", body.page,
            )
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {
            **result,
            "pageCount": book.page_count,
            "imageUrl": f"/api/books/{book.id}/pages/{body.page}/image",
        }

    @app.post("/api/books/{book_id}/exports/m4b")
    @app.post("/api/books/{book_id}/exports/audio")
    async def export_book_audio(book_id: str, request: Request) -> Response:
        custom_cover: tuple[bytes, str] | None = None
        try:
            if "application/json" in request.headers.get("content-type", ""):
                body = AudioExportRequest.model_validate(await request.json())
            else:
                form = await request.form()
                raw_chapters = form.get("chapters")
                if not isinstance(raw_chapters, str):
                    raise ValueError("Export chapters are required")
                body = AudioExportRequest.model_validate(
                    {
                        "chapters": json.loads(raw_chapters),
                        "title": form.get("title"),
                        "author": form.get("author"),
                        "description": form.get("description"),
                        "coverPage": form.get("coverPage") or 1,
                        "preset": form.get("preset") or AudioExportPreset.M4B_HIGH,
                    }
                )
                cover_upload = form.get("cover")
                if cover_upload is not None:
                    content_type = str(getattr(cover_upload, "content_type", ""))
                    suffixes = {
                        "image/jpeg": ".jpg",
                        "image/png": ".png",
                        "image/webp": ".webp",
                    }
                    if content_type not in suffixes or not hasattr(cover_upload, "read"):
                        raise ValueError("Cover image must be a PNG, JPEG, or WebP file")
                    cover_bytes = await cover_upload.read(20 * 1024 * 1024 + 1)
                    if not cover_bytes:
                        raise ValueError("Cover image is empty")
                    if len(cover_bytes) > 20 * 1024 * 1024:
                        raise ValueError("Cover image must be 20 MB or smaller")
                    custom_cover = (cover_bytes, suffixes[content_type])
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if request.url.path.endswith("/exports/m4b") and body.preset != AudioExportPreset.M4B_HIGH:
            raise HTTPException(
                status_code=422,
                detail="Use the audio export endpoint for non-default formats",
            )

        try:
            book = require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if body.coverPage > (book.page_count or 1):
            raise HTTPException(status_code=422, detail="Cover page is outside this PDF")
        requested = [(row.chapterId, row.revision) for row in body.chapters]
        requested_ids = [chapter_id for chapter_id, _revision in requested]
        requested_revisions = dict(requested)
        if len(requested_ids) != len(set(requested_ids)):
            raise HTTPException(status_code=422, detail="Each chapter may be exported only once")

        package = package_for(book.id)
        try:
            dialogue = read_artifact(package, "dialogue")
            review = read_artifact(package, "review")
            recording_script = ensure_recording_script(book.id)
            current_revisions = {
                "dialogue": str(dialogue["revision"]),
                "review": str(review["revision"]),
                "cast": str(read_artifact(package, "cast")["revision"]),
                "script": str(recording_script["revision"]),
            }
        except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
            raise HTTPException(
                status_code=409,
                detail="Finish Dialogue, Review, and Cast before exporting current audio",
            ) from error

        chapter_titles, chapter_order = _export_chapter_catalog(
            dialogue, review, recording_script
        )
        unknown = [chapter_id for chapter_id in requested_ids if chapter_id not in chapter_titles]
        if unknown:
            raise HTTPException(status_code=422, detail={"invalidChapterIds": unknown})

        export_chapters: list[M4BChapter] = []
        recipe_comparison_cache = {}
        for chapter_id, revision in requested:
            pointer = package / "audio" / chapter_id / "latest.json"
            metadata_path = package / "audio" / chapter_id / revision / "metadata.json"
            audio_path = package / "audio" / chapter_id / revision / "chapter.wav"
            try:
                latest = json.loads(pointer.read_text(encoding="utf-8"))
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, ValueError, json.JSONDecodeError) as error:
                raise HTTPException(
                    status_code=409,
                    detail=f"{chapter_titles[chapter_id]} is missing or stale; regenerate it before export",
                ) from error
            if str(latest.get("revision")) != revision or chapter_audio_stale_reasons(
                package, {**metadata, "chapterId": chapter_id}, current_revisions,
                comparison_cache=recipe_comparison_cache,
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"{chapter_titles[chapter_id]} is missing or stale; regenerate it before export",
                )
            export_chapters.append(M4BChapter(chapter_id, chapter_titles[chapter_id], audio_path))
        order = {chapter_id: index for index, chapter_id in enumerate(chapter_order)}
        export_chapters.sort(key=lambda chapter: order[chapter.chapter_id])

        source = source_path(root, book.id, book.source_name or "book.pdf")
        try:
            metadata = await run_in_threadpool(
                file_processor.pdf_metadata if file_processor is not None else pdf_metadata, source,
            )
        except (OSError, ValueError):
            metadata = {}
        title = (
            (body.title or "").strip()
            or metadata.get("title")
            or book.title
            or Path(book.source_name or "book").stem
        )
        author = (
            (body.author or "").strip() or metadata.get("author") or book.author or "Meowdiobooks"
        )
        description = body.description.strip() if body.description is not None else None
        temp_root = root / "tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix=f"m4b-{book.id}-", dir=temp_root))
        try:
            if custom_cover:
                cover = work / f"cover{custom_cover[1]}"
                cover.write_bytes(custom_cover[0])
            elif file_processor is not None:
                # A host rejection must fail closed; its permitted paths and policy
                # may not include the local application's fallback asset.
                cover = await run_in_threadpool(
                    file_processor.render_pdf_page, source, package / "preview", body.coverPage,
                )
            else:
                try:
                    cover = await run_in_threadpool(
                        render_pdf_page, source, package / "preview", body.coverPage,
                    )
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    cover = (
                        repo_root / "frontend" / "src" / "assets" / "brand" / "meowdiobooks-mark.png"
                    )
            partial = len(export_chapters) != len(chapter_order)
            profile = audio_export_profile(body.preset)
            filename = export_filename(title, partial=partial, preset=body.preset)
            output = work / filename
            with ExitStack() as audio_sources:
                materialized_chapters: list[M4BChapter] = []
                for chapter in export_chapters:
                    materialized_path = Path(
                        audio_sources.enter_context(
                            chapter_audio_source(
                                book.id,
                                chapter.chapter_id,
                                requested_revisions[chapter.chapter_id],
                                chapter.audio_path,
                            )
                        )
                    )
                    if not materialized_path.is_file():
                        raise FileNotFoundError(
                            f"Audio source did not provide {chapter.title}"
                        )
                    materialized_chapters.append(
                        M4BChapter(chapter.chapter_id, chapter.title, materialized_path)
                    )
                await run_in_threadpool(
                    file_processor.package_audio_export if file_processor is not None else package_audio_export,
                    materialized_chapters,
                    output,
                    title=title,
                    author=author,
                    description=description,
                    cover=cover,
                    preset=body.preset,
                )
        except FFmpegUnavailableError as error:
            shutil.rmtree(work, ignore_errors=True)
            report_operation_failure("export", book_id, error)
            raise HTTPException(status_code=503, detail=public_error_message(
                error, "Audio export is temporarily unavailable. Please try again later."
            )) from error
        except (M4BExportError, ValueError) as error:
            shutil.rmtree(work, ignore_errors=True)
            report_operation_failure("export", book_id, error)
            raise HTTPException(status_code=422, detail=public_error_message(
                error, "We couldn’t create the audiobook download. Please try again."
            )) from error
        except (OSError, RuntimeError) as error:
            shutil.rmtree(work, ignore_errors=True)
            report_operation_failure("export", book_id, error)
            raise HTTPException(
                status_code=409,
                detail="Chapter audio could not be prepared for export",
            ) from error
        except BaseException:
            shutil.rmtree(work, ignore_errors=True)
            raise
        try:
            library_root.mkdir(parents=True, exist_ok=True)
            destination = _available_library_path(library_root, filename)
            chapter_positions = [
                chapter_order.index(chapter.chapter_id) + 1 for chapter in export_chapters
            ]
            item = LibraryExport(
                book_id=book.id,
                title=title,
                author=author,
                description=description,
                filename=destination.name,
                file_path=str(destination),
                chapter_count=len(export_chapters),
                chapter_titles=[chapter.title for chapter in export_chapters],
                chapter_positions=chapter_positions,
                partial=partial,
                size_bytes=output.stat().st_size,
                preset=body.preset,
                media_type=profile.media_type,
            )
            library_cover_root.mkdir(parents=True, exist_ok=True)
            cover_destination = library_cover_root / f"{item.id}{cover.suffix.lower() or '.jpg'}"
            item.cover_path = str(cover_destination)
            _commit_library_export(
                item,
                audio_source=output,
                cover_source=cover,
                audio_destination=destination,
                cover_destination=cover_destination,
                library=library,
                on_library_exported=on_library_exported,
                retain_local=retain_local_library_exports,
            )
        except (OSError, RuntimeError) as error:
            shutil.rmtree(work, ignore_errors=True)
            report_operation_failure("export-save", book_id, error)
            raise HTTPException(
                status_code=500,
                detail="The audiobook was created but could not be saved to your Library",
            ) from error
        shutil.rmtree(work, ignore_errors=True)
        if (
            not retain_local_library_exports
            or "application/json" in request.headers.get("accept", "")
        ):
            return JSONResponse(
                _library_export_payload(item, package=package),
                status_code=status.HTTP_201_CREATED,
            )
        return FileResponse(
            destination,
            media_type=item.media_type,
            filename=destination.name,
        )

    @app.post("/api/books/{book_id}/dialogue/preview")
    def dialogue_preview(book_id: str, body: DialoguePreviewRequest) -> dict[str, Any]:
        try:
            extraction = extraction_payload(book_id)
            result = scan_dialogue(
                extraction["blocks"],
                **dialogue_scan_settings(body.model_dump(exclude_none=True)),
            )
        except (ValueError, RuntimeError, DialogueContractError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        target_statuses = set()
        if "open-speakers" in body.attributionTargets:
            target_statuses.update({"open", "unresolved"})
        if "unlabelled-candidates" in body.attributionTargets:
            target_statuses.add("unlabelled")
        target_count = len(
            {
                str(span.get("turnGroupId") or span["id"])
                for span in result.get("partition", [])
                if span.get("renderRole") == "dialogue"
                and span.get("speakerStatus") in target_statuses
            }
        )
        return {
            **result,
            "successfulProfiles": [row for row in result["profiles"] if row["matchCount"]],
            "extractionRevision": extraction["revision"],
            "routing": dialogue_routing_preview(repo_root, target_count),
        }

    @app.post("/api/books/{book_id}/review/bulk-preview")
    def review_bulk_preview(book_id: str, body: ReviewBulkPreviewRequest) -> dict[str, Any]:
        """Preview exact bulk scope and consequences without publishing a decision."""

        try:
            require_book(book_id)
            workspace = _candidate(package_for(book_id), "review", body.revision)
            current_dialogue = read_artifact(package_for(book_id), "dialogue")
            if workspace.get("dialogueRevision") != current_dialogue.get("revision"):
                raise ReviewContractError(
                    "Review candidate references a superseded Dialogue revision"
                )
            return {
                "reviewRevision": body.revision,
                **preview_bulk_decision(workspace, body.occurrenceId, body.action),
                "published": False,
            }
        except (ValueError, RuntimeError, ReviewContractError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/books/{book_id}/review/transcript-preview")
    def review_transcript_preview(
        book_id: str, body: ReviewTranscriptPreviewRequest
    ) -> dict[str, Any]:
        """Preview the exact page-level transcript before Review is accepted."""

        try:
            book = require_book(book_id)
            package = package_for(book_id)
            workspace = _candidate(package, "review", body.revision)
            extraction = read_artifact(package, "extraction")
            dialogue = read_artifact(package, "dialogue")
            if workspace.get("extractionRevision") != extraction.get("revision"):
                raise ReviewContractError(
                    "Review candidate references a superseded Extraction revision"
                )
            if workspace.get("dialogueRevision") != dialogue.get("revision"):
                raise ReviewContractError(
                    "Review candidate references a superseded Dialogue revision"
                )
            result = preview_review_transcript_page(
                extraction,
                dialogue,
                workspace,
                [policy.model_dump() for policy in body.policies],
                page=body.page,
                page_count=book.page_count,
                occurrence_policies=[policy.model_dump() for policy in body.occurrencePolicies],
            )
            return {
                **result,
                "pageCount": book.page_count or result["pageCount"],
                "imageUrl": f"/api/books/{book_id}/pages/{body.page}/image",
                "published": False,
            }
        except (ValueError, RuntimeError, ReviewContractError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/books/{book_id}/stages/{stage}/process", status_code=202)
    def process_stage(book_id: str, stage: str, body: StageProcessRequest) -> dict[str, Any]:
        try:
            book = require_book(book_id)
            parsed = WizardStage(stage)
        except ValueError as error:
            raise HTTPException(
                status_code=404 if str(error) == "Book not found" else 422, detail=str(error)
            ) from error
        try:
            stage_spec = PUBLIC_WORKFLOW.stage(parsed.value)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        accepted = {row.stage.value for row in book.accepted_stage_revisions}
        active_artifact_kinds = active_artifacts(package_for(book_id))
        for prerequisite_id in stage_spec.prerequisites:
            prerequisite = PUBLIC_WORKFLOW.stage(prerequisite_id)
            if prerequisite_id == "import":
                if prerequisite_id not in accepted:
                    raise HTTPException(status_code=409, detail="Accept import first")
                continue
            if prerequisite.artifact_kind not in active_artifact_kinds:
                raise HTTPException(
                    status_code=409,
                    detail=f"Accept {prerequisite.artifact_kind or prerequisite_id} first",
                )
        try:
            command = command_for_stage(book_id, parsed, body.settings)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        kind = command.kind
        active = next(
            (
                job
                for job in jobs.all()
                if job.kind == kind
                and job.payload.get("book_id") == book_id
                and job.status.value in {"queued", "running"}
            ),
            None,
        )
        if active:
            raise HTTPException(status_code=409, detail={"jobId": active.id})
        payload = {
            **command.to_job_payload(),
            "workflow_version": PUBLIC_WORKFLOW.version,
        }
        resumable = (
            _matching_failed_job(jobs.all(), kind, payload)
            if parsed in {WizardStage.CAST, WizardStage.GENERATE}
            else None
        )
        job = queue.enqueue(
            kind,
            payload,
            retry_of=resumable.id if resumable else None,
            attempt=resumable.attempt + 1 if resumable else 1,
        )
        return job.model_dump(mode="json")

    @app.post("/api/books/{book_id}/cast/reuse-preview")
    def casting_reuse_preview(book_id: str, body: CastingPreviewRequest) -> dict[str, Any]:
        require_book(book_id)
        if cast_voice_reuse is None:
            raise HTTPException(status_code=404, detail="Voice reuse is unavailable")
        package = package_for(book_id)
        try:
            proposal = _candidate(package, "cast", body.proposalRevision)
            validate_cast_proposal_inputs(
                proposal, read_artifact(package, "dialogue"), read_artifact(package, "review")
            )
            if proposal.get("phase") not in {"identity-review", "audition-review"}:
                raise CastContractError("Auditions require an editable Cast candidate")
            raw = body.identityDecisions
            if raw is None:
                raw = proposal.get("identityDecisions", [])
            decisions = {str(row.get("label", "")): row for row in raw if row.get("label")}
            finalized = finalize_identity_mapping(proposal.get("proposals", []), decisions)
            preview_language = normalize_language(body.language or proposal.get("language") or "english")
            if (proposal.get("phase") == "audition-review"
                    and preview_language == normalize_language(proposal.get("language", "english"))):
                _reuse_unchanged_cast_voices(finalized, proposal)
            targets = cast_voice_targets(
                finalized, proposal,
                read_artifact(package, "dialogue"), read_artifact(package, "review"),
            )
            source_ids = validate_source_book_ids(body.sourceBookIds, book_id)
            model_id = str(body.voiceModel or proposal.get("voiceModel") or default_voice_id)
            language = normalize_language(body.language or proposal.get("language") or "english")
            if not language or language not in voice_languages(repo_root, model_id):
                raise CastContractError("Select a supported voice language")
            return cast_voice_reuse.preview(book_id, package, targets, source_ids, language, model_id)
        except (ValueError, CastContractError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.get("/api/books/{book_id}/stages/{stage}/candidates/{revision}")
    def stage_candidate(book_id: str, stage: str, revision: str) -> dict[str, Any]:
        """Return a complete immutable candidate for pre-acceptance result review."""
        try:
            require_book(book_id)
            parsed = WizardStage(stage)
        except ValueError as error:
            raise HTTPException(
                status_code=404 if str(error) == "Book not found" else 422,
                detail=str(error),
            ) from error
        kind = _STAGE_KIND.get(parsed)
        if kind is None:
            raise HTTPException(status_code=422, detail=f"Stage {stage} has no candidate artifact")
        candidate = next(
            (
                row
                for row in artifact_history(package_for(book_id), kind)
                if str(row.get("revision")) == revision
            ),
            None,
        )
        if candidate is None:
            raise HTTPException(status_code=404, detail=f"{stage.title()} candidate not found")
        if parsed == WizardStage.CAST:
            candidate = _cast_with_line_counts(
                candidate, read_artifact(package_for(book_id), "dialogue"),
                read_artifact(package_for(book_id), "review")
            )
        return candidate

    @app.post(
        "/api/books/{book_id}/voice-samples/transcribe",
    )
    async def transcribe_uploaded_voice_sample(
        book_id: str,
        file: UploadFile = File(...),
    ) -> dict[str, Any]:
        """Return an editable, auto-language transcript without retaining the upload."""

        try:
            require_book(book_id)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        filename = Path(file.filename or "").name
        if Path(filename).suffix.casefold() not in VOICE_SAMPLE_SUFFIXES:
            raise HTTPException(status_code=415, detail="Use a WAV, MP3, or FLAC voice sample")
        chunks: list[bytes] = []
        total = 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > _MAX_VOICE_SAMPLE_BYTES:
                raise HTTPException(status_code=413, detail="Voice sample exceeds the 25 MB limit")
            chunks.append(chunk)
        try:
            normalized, _duration = await run_in_threadpool(
                file_processor.normalize_voice_sample if file_processor is not None else normalize_voice_sample,
                b"".join(chunks), filename,
            )
            with tempfile.NamedTemporaryFile(suffix=".wav") as sample:
                sample.write(normalized)
                sample.flush()
                draft = await run_in_threadpool(
                    voice_sample_transcriber, repo_root, book_id, Path(sample.name),
                )
        except RuntimeError as error:
            action_error = action_required_http_exception(error)
            if action_error is not None:
                raise action_error from error
            report_operation_failure("transcribe", book_id, error)
            raise HTTPException(
                status_code=503,
                detail=public_error_message(error, "We couldn’t transcribe the voice sample. Please try again."),
            ) from error
        except ValueError as error:
            action_error = action_required_http_exception(error)
            if action_error is not None:
                raise action_error from error
            if not isinstance(error, WorkflowInputError):
                report_operation_failure("transcribe", book_id, error)
            raise HTTPException(status_code=422, detail=public_error_message(
                error, "We couldn’t transcribe the voice sample. Please try again."
            )) from error
        except Exception as error:
            action_error = action_required_http_exception(error)
            if action_error is not None:
                raise action_error from error
            report_operation_failure("transcribe", book_id, error)
            raise HTTPException(status_code=503, detail=public_error_message(
                error, "We couldn’t transcribe the voice sample. Please try again."
            )) from error
        return {"text": draft.text, "language": draft.language}

    @app.post(
        "/api/books/{book_id}/stages/cast/candidates/{revision}/voices/{character_id}/upload",
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_voice_sample(
        book_id: str,
        revision: str,
        character_id: str,
        reference_text: str = Form(...),
        file: UploadFile = File(...),
    ) -> dict[str, Any]:
        """Create one audition from a transcript-conditioned local speaker reference."""

        try:
            require_book(book_id)
            package = package_for(book_id)
            candidate = _candidate(package, "cast", revision)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if candidate.get("phase") != "audition-review":
            raise HTTPException(status_code=409, detail="Voice samples require an editable Voice draft")
        try:
            validate_cast_proposal_inputs(
                candidate, read_artifact(package, "dialogue"), read_artifact(package, "review")
            )
            _require_current_voice_draft(package, revision)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        model_id = str(candidate.get("voiceModel") or default_voice_id)
        if str(candidate.get("auditionPackRecipeVersion", "")) != current_voice_recipe_version(
            model_id
        ):
            raise HTTPException(
                status_code=409,
                detail="The audition recipe changed; regenerate the complete audition pack first",
            )

        rows = [candidate.get("narrator"), *candidate.get("identities", [])]
        target = next(
            (
                row
                for row in rows
                if isinstance(row, dict) and str(row.get("characterId")) == character_id
            ),
            None,
        )
        if target is None:
            raise HTTPException(status_code=404, detail="Cast voice not found")

        reference_text = " ".join(reference_text.split()).strip()
        if not reference_text:
            raise HTTPException(status_code=422, detail="Enter exactly what is said in the sample")
        if len(reference_text) > 2_000:
            raise HTTPException(
                status_code=422,
                detail="Voice sample transcript must be 2,000 characters or fewer",
            )

        filename = Path(file.filename or "").name
        if Path(filename).suffix.casefold() not in VOICE_SAMPLE_SUFFIXES:
            raise HTTPException(status_code=415, detail="Use a WAV, MP3, or FLAC voice sample")
        chunks: list[bytes] = []
        total = 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > _MAX_VOICE_SAMPLE_BYTES:
                raise HTTPException(status_code=413, detail="Voice sample exceeds the 25 MB limit")
            chunks.append(chunk)
        try:
            normalized, duration = await run_in_threadpool(
                file_processor.normalize_voice_sample if file_processor is not None else normalize_voice_sample,
                b"".join(chunks), filename,
            )
        except Exception as error:
            action_error = action_required_http_exception(error)
            if action_error is not None:
                raise action_error from error
            if not isinstance(error, WorkflowInputError):
                report_operation_failure("clone", book_id, error)
            raise HTTPException(status_code=422, detail=public_error_message(
                error, "We couldn’t prepare the voice sample. Please try again."
            )) from error

        audition_text = str(target.get("referenceText") or "").strip()
        if not audition_text:
            audition_text = next(
                (
                    str(row.get("referenceText") or "").strip()
                    for row in reversed(target.get("voiceCandidates", []))
                    if isinstance(row, dict) and str(row.get("referenceText") or "").strip()
                ),
                "",
            )
        if not audition_text:
            raise HTTPException(status_code=422, detail="No audition line is available for this voice")

        voice_revision = uuid4().hex
        cast_revision = uuid4().hex
        audition_relative = Path("voices") / character_id / f"{voice_revision}.wav"
        reference_relative = Path("voices") / character_id / f"{voice_revision}.reference.wav"
        output = (package / audition_relative).resolve()
        reference_output = (package / reference_relative).resolve()
        voice_root = (package / "voices").resolve()
        if voice_root not in output.parents or voice_root not in reference_output.parents:
            raise HTTPException(status_code=422, detail="Cast voice has an invalid storage path")
        try:
            atomic_write(reference_output, normalized)
            audition = await run_in_threadpool(
                voice_sample_auditioner,
                repo_root,
                package,
                book_id,
                character_id,
                voice_revision,
                reference_output,
                reference_text,
                audition_text,
                normalize_language(candidate.get("language", "english")),
                str(candidate.get("voiceModel") or default_voice_id),
            )
            atomic_write(output, audition)
        except Exception as error:
            output.unlink(missing_ok=True)
            reference_output.unlink(missing_ok=True)
            action_error = action_required_http_exception(error)
            if action_error is not None:
                raise action_error from error
            report_operation_failure("clone", book_id, error)
            raise HTTPException(
                status_code=422,
                detail=public_error_message(error, "We couldn’t create the voice audition. Please try again."),
            ) from error
        preview_url = f"/api/books/{book_id}/voices/{character_id}/{voice_revision}/audio"
        candidates = [
            row for row in target.get("voiceCandidates", []) if isinstance(row, dict)
        ]
        voice_candidate = {
            "revision": voice_revision,
            "previewUrl": preview_url,
            "previewText": audition_text,
            "referenceText": reference_text,
            "referenceAudio": str(reference_relative),
            "direction": "Cloned from uploaded voice sample",
            "source": "upload",
            "referenceMode": "transcript-conditioned",
            "durationSeconds": round(duration, 3),
            "parentRevision": candidates[-1].get("revision") if candidates else None,
        }
        updated = {
            **target,
            "voicePreviewRevision": voice_revision,
            "previewUrl": preview_url,
            "referenceText": audition_text,
            "voiceCandidates": [*candidates, voice_candidate],
            "voiceAccepted": False,
        }
        updated.pop("voicePreviewError", None)
        identities = [
            updated if str(row.get("characterId")) == character_id else row
            for row in candidate.get("identities", [])
        ]
        body = {
            **candidate,
            "revision": cast_revision,
            "phase": "audition-review",
            "status": "needs-voice-review",
            "narrator": updated if character_id == "narrator" else candidate.get("narrator"),
            "identities": identities,
        }
        try:
            _validate_voice_audio(package, character_id, voice_candidate)
        except ValueError as error:
            output.unlink(missing_ok=True)
            reference_output.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail=str(error)) from error
        try:
            validate_cast_proposal_inputs(
                candidate, read_artifact(package, "dialogue"), read_artifact(package, "review")
            )
            _require_current_voice_draft(package, revision)
            _path, artifact = write_cast_candidate(package, body)
        except ValueError as error:
            output.unlink(missing_ok=True)
            reference_output.unlink(missing_ok=True)
            raise HTTPException(status_code=409, detail=str(error)) from error
        except Exception:
            output.unlink(missing_ok=True)
            reference_output.unlink(missing_ok=True)
            raise
        return artifact

    @app.delete(
        "/api/books/{book_id}/stages/cast/candidates/{revision}/voices/"
        "{character_id}/{voice_revision}"
    )
    def delete_voice_audition(
        book_id: str,
        revision: str,
        character_id: str,
        voice_revision: str,
    ) -> dict[str, Any]:
        """Remove one audition from the active draft while preserving immutable history."""

        try:
            require_book(book_id)
            package = package_for(book_id)
            candidate = _candidate(package, "cast", revision)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if candidate.get("phase") != "audition-review":
            raise HTTPException(status_code=409, detail="Auditions require an editable Voice draft")
        try:
            validate_cast_proposal_inputs(
                candidate, read_artifact(package, "dialogue"), read_artifact(package, "review")
            )
            _require_current_voice_draft(package, revision)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        rows = [candidate.get("narrator"), *candidate.get("identities", [])]
        target = next(
            (
                row
                for row in rows
                if isinstance(row, dict) and str(row.get("characterId")) == character_id
            ),
            None,
        )
        if target is None:
            raise HTTPException(status_code=404, detail="Cast voice not found")
        candidates = [
            row for row in target.get("voiceCandidates", []) if isinstance(row, dict)
        ]
        if len(candidates) <= 1:
            raise HTTPException(status_code=409, detail="Keep at least one audition")
        removed = next(
            (row for row in candidates if str(row.get("revision")) == voice_revision),
            None,
        )
        if removed is None:
            raise HTTPException(status_code=404, detail="Voice audition not found")
        remaining = [
            row for row in candidates if str(row.get("revision")) != voice_revision
        ]
        updated = {**target, "voiceCandidates": remaining, "voiceAccepted": False}
        if str(target.get("voicePreviewRevision")) == voice_revision:
            fallback = remaining[-1]
            updated.update(
                {
                    "voicePreviewRevision": fallback.get("revision"),
                    "previewUrl": fallback.get("previewUrl"),
                    "referenceText": fallback.get("referenceText"),
                    "referenceAudio": fallback.get("referenceAudio"),
                    "referenceMode": fallback.get("referenceMode"),
                    "voiceDirection": fallback.get("direction") or target.get("voiceDirection"),
                    "voiceSettings": fallback.get("voiceSettings") or target.get("voiceSettings"),
                }
            )
        if str(target.get("acceptedVoiceRevision")) == voice_revision:
            updated.pop("acceptedVoiceRevision", None)
            updated.pop("voiceRevision", None)
        identities = [
            updated if str(row.get("characterId")) == character_id else row
            for row in candidate.get("identities", [])
        ]
        body = {
            **candidate,
            "revision": uuid4().hex,
            "phase": "audition-review",
            "status": "needs-voice-review",
            "narrator": updated if character_id == "narrator" else candidate.get("narrator"),
            "identities": identities,
        }
        _path, artifact = write_cast_candidate(package, body)
        return artifact

    @app.post("/api/books/{book_id}/stages/{stage}/accept")
    def accept_stage(book_id: str, stage: str, body: StageAcceptRequest) -> dict[str, Any]:
        try:
            book = require_book(book_id)
            parsed = WizardStage(stage)
        except ValueError as error:
            raise HTTPException(
                status_code=404 if str(error) == "Book not found" else 422, detail=str(error)
            ) from error
        kind = _STAGE_KIND.get(parsed)
        if kind is None:
            raise HTTPException(status_code=422, detail=f"Stage {stage} cannot be accepted here")
        candidates = {
            str(row["revision"]): row for row in artifact_history(package_for(book_id), kind)
        }
        candidate = candidates.get(body.revision)
        if candidate is None:
            raise HTTPException(status_code=404, detail=f"{stage.title()} candidate not found")
        try:
            if parsed == WizardStage.DIALOGUE:
                extraction = read_artifact(package_for(book_id), "extraction")
                if candidate.get("extractionRevision") != extraction.get("revision"):
                    raise DialogueContractError(
                        "Dialogue candidate references a superseded Extraction revision"
                    )
                blockers = dialogue_progression_blockers(candidate)
                if blockers:
                    raise DialogueContractError("; ".join(blockers))
            if parsed == WizardStage.REVIEW:
                dialogue = read_artifact(package_for(book_id), "dialogue")
                if candidate.get("dialogueRevision") != dialogue.get("revision"):
                    raise ReviewContractError(
                        "Review candidate references a superseded Dialogue revision"
                    )
            if parsed == WizardStage.CAST:
                dialogue = read_artifact(package_for(book_id), "dialogue")
                review = read_artifact(package_for(book_id), "review")
                if candidate.get("dialogueRevision") != dialogue.get("revision") or candidate.get(
                    "reviewRevision"
                ) != review.get("revision"):
                    raise CastContractError("Cast candidate references superseded inputs")
                if candidate.get("phase") != "audition-review":
                    raise CastContractError(
                        "Resolve identities and generate auditions before acceptance"
                    )
                narrator_required = any(
                    row["characterId"] == "narrator"
                    for row in cast_voice_targets(candidate, candidate, dialogue, review)
                )
                if narrator_required and not isinstance(candidate.get("narrator"), dict):
                    raise CastContractError("Generate and accept the required narrator voice")
            if parsed == WizardStage.REVIEW:
                warning_decisions = [row for row in body.decisions if row.get("occurrenceIds")]
                boundary_decisions = [row for row in body.decisions if row.get("boundaryId")]
                accepted_payload = accept_review_revision(
                    candidate,
                    warning_decisions,
                    revision=uuid4().hex,
                )
                if accepted_payload["requiresNewUpstreamRevision"]:
                    upstream = [
                        {
                            "occurrenceId": row["occurrenceId"],
                            "action": row["action"],
                            "nextStage": (
                                "dialogue" if row["action"] == "rerun-dialogue" else "extract"
                            ),
                            "downstreamInvalidation": row["consequence"]["downstreamInvalidation"],
                        }
                        for row in accepted_payload["decisions"]
                        if row["action"] in {"rerun-extraction", "rerun-dialogue"}
                    ]
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": "Publish the requested upstream revision before accepting Review",
                            "requiresNewUpstreamRevision": True,
                            "actions": upstream,
                            "reviewPublished": False,
                        },
                    )
                chapter_plan = compile_reviewed_chapters(
                    read_artifact(package_for(book_id), "dialogue").get("spans", []),
                    candidate.get("boundaryCandidates", []),
                    boundary_decisions,
                )
                accepted_payload.update(chapter_plan)
                # Review owns both chapter assignment and render-policy decisions. Compile the
                # complete downstream Dialogue shape before publishing, so later stages never
                # discover an accepted Review revision that they cannot execute.
                _dialogue_with_chapters(dialogue, accepted_payload)
                path, accepted_payload = write_artifact(
                    package_for(book_id), "review", accepted_payload, publish=False
                )
                if not accepted_payload["canStartCast"]:
                    raise ReviewContractError("Review still has progression blockers")
            elif parsed == WizardStage.DIALOGUE:
                if body.decisions:
                    accepted_payload = apply_dialogue_corrections(
                        candidate,
                        body.decisions,
                        revision=uuid4().hex,
                    )
                    validate_dialogue_partition(accepted_payload)
                    path, accepted_payload = write_artifact(
                        package_for(book_id), "dialogue", accepted_payload, publish=False
                    )
                else:
                    path = package_for(book_id) / "artifacts" / kind / f"{body.revision}.json"
            elif parsed == WizardStage.CAST:
                model_id = str(candidate.get("voiceModel") or default_voice_id)
                if str(
                    candidate.get("auditionPackRecipeVersion", "")
                ) != current_voice_recipe_version(model_id):
                    raise CastContractError(
                        "The audition recipe changed; regenerate the complete audition pack first"
                    )
                accepted_payload = _accept_voice_revisions(candidate, body.decisions, uuid4().hex)
                for voice in [accepted_payload.get("narrator"), *accepted_payload.get("identities", [])]:
                    if isinstance(voice, dict) and voice.get("acceptedVoiceRevision"):
                        _validate_voice_audio(package_for(book_id), str(voice["characterId"]), voice)
                path, accepted_payload = write_artifact(
                    package_for(book_id), "cast", accepted_payload, publish=False
                )
            else:
                path = package_for(book_id) / "artifacts" / kind / f"{body.revision}.json"
            workspace = workspace_for(book_id)
            workspace.publish(kind, path)
            published_revision = workspace.read(kind)["revision"]
        except (
            CastContractError,
            ChapterContractError,
            DialogueContractError,
            ValueError,
            RuntimeError,
            ReviewContractError,
            RecordingScriptContractError,
        ) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        prior = [row for row in book.accepted_stage_revisions if row.stage == parsed]
        book.accepted_stage_revisions.append(
            StageRevision(
                stage=parsed,
                revision=(prior[-1].revision if prior else 0) + 1,
                data={
                    "artifactRevision": published_revision,
                    "sourceCandidateRevision": body.revision,
                },
            )
        )
        book.stage = parsed
        book.updated_at = utc_now()
        books.put(book)
        if parsed == WizardStage.CAST:
            retain_cast_voice_revisions(
                package_for(book_id),
                cast_voice_revisions(workspace_for(book_id).read("cast")),
            )
        return book.model_dump(mode="json")

    app.router.routes.extend(create_media_router(
        root, require_book, package_for,
        page_renderer=file_processor.render_pdf_page if file_processor is not None else None,
    ).routes)
    app.router.routes.extend(
        create_library_router(
            library,
            require_library_export,
            package_for,
            _library_export_payload,
            library_export_available,
        ).routes
    )
    app.router.routes.extend(create_jobs_router(jobs, queue, require_book).routes)
    mount_local_frontend(app, frontend_dist_path(repo_root, explicit=frontend_dist))
    return app


def _local_voice_sample_transcriber(
    repo_root: Path,
    _book_id: str,
    sample_path: Path,
) -> TranscriptionDraft:
    return transcribe_voice_sample(repo_root, sample_path)


def _local_voice_sample_auditioner(
    repo_root: Path,
    _package: Path,
    _book_id: str,
    _character_id: str,
    _voice_revision: str,
    reference_audio: Path,
    reference_text: str,
    text: str,
    language: str,
    model_id: str,
) -> bytes:
    return generate_cloned_audition(
        repo_root,
        reference_audio,
        reference_text,
        text,
        language,
        model_id,
    )


def _candidate_result(
    book_id: str, stage: WizardStage, path: Path, artifact: dict[str, Any]
) -> dict[str, Any]:
    return {
        "bookId": book_id,
        "stage": stage.value,
        "revision": artifact["revision"],
        "artifactPath": str(path),
        "summary": artifact.get("resultSummary", artifact.get("summary", {})),
    }


def _available_library_path(root: Path, filename: str) -> Path:
    candidate = root / filename
    if not candidate.exists():
        return candidate
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    index = 2
    while True:
        candidate = root / f"{stem} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _export_chapter_catalog(
    dialogue: dict[str, Any],
    review: dict[str, Any],
    recording_script: dict[str, Any] | None = None,
) -> tuple[dict[str, str], list[str]]:
    accepted_chapters = [
        row
        for row in (recording_script or {}).get("chapters", [])
        if isinstance(row, dict)
    ] or [row for row in review.get("chapters", []) if isinstance(row, dict)]
    if accepted_chapters:
        titles = {
            str(row["id"]): str(row.get("title") or _chapter_display_title(str(row["id"])))
            for row in accepted_chapters
            if row.get("id")
        }
        return titles, list(titles)
    titles: dict[str, str] = {}
    order: list[str] = []
    for span in dialogue.get("spans", []):
        chapter_id = str(span.get("chapterId") or "chapter-1")
        if chapter_id not in titles:
            raw_title = str(span.get("chapterTitle") or "").strip()
            titles[chapter_id] = raw_title or _chapter_display_title(chapter_id)
            order.append(chapter_id)
    return titles, order


def _library_export_payload(item: LibraryExport, *, package: Path | None = None) -> dict[str, Any]:
    chapter_titles = item.chapter_titles
    if not chapter_titles:
        try:
            chapter_titles = embedded_chapter_titles(Path(item.file_path))
        except (FFmpegUnavailableError, M4BExportError):
            chapter_titles = []
    chapter_positions = item.chapter_positions
    if not chapter_positions and chapter_titles and package is not None:
        try:
            catalog, order = _export_chapter_catalog(
                read_artifact(package, "dialogue"),
                read_artifact(package, "review"),
                read_artifact(package, "script"),
            )
            by_title: dict[str, list[int]] = {}
            for position, chapter_id in enumerate(order, start=1):
                by_title.setdefault(catalog[chapter_id].strip().casefold(), []).append(position)
            matched = [by_title.get(title.strip().casefold(), []) for title in chapter_titles]
            if all(len(positions) == 1 for positions in matched):
                chapter_positions = [positions[0] for positions in matched]
        except (OSError, ValueError, RuntimeError, json.JSONDecodeError):
            chapter_positions = []
    return {
        "id": item.id,
        "bookId": item.book_id,
        "title": item.title,
        "author": item.author,
        "description": item.description,
        "filename": item.filename,
        "location": item.file_path,
        "chapterCount": item.chapter_count,
        "chapterTitles": chapter_titles,
        "chapterPositions": chapter_positions,
        "partial": item.partial,
        "sizeBytes": item.size_bytes,
        "preset": item.preset,
        "mediaType": item.media_type,
        "createdAt": item.created_at.isoformat(),
    }


def _publish_with_invalidation(package: Path, kind: str, path: Path) -> None:
    BookWorkspace(package).publish(kind, path)


def _history_summary(
    artifact: dict[str, Any],
    *,
    active_revision: str = "",
    accepted_revisions: set[str] | None = None,
) -> dict[str, Any]:
    revision = str(artifact.get("revision", ""))
    accepted = accepted_revisions or set()
    status = (
        "accepted"
        if revision and revision == active_revision
        else "superseded"
        if revision in accepted
        else "candidate"
    )
    return {
        "revision": artifact.get("revision"),
        "status": status,
        "extractionRevision": artifact.get("extractionRevision"),
        "dialogueRevision": artifact.get("dialogueRevision"),
        "summary": artifact.get("resultSummary", artifact.get("summary", {})),
    }


def _candidate(package: Path, kind: str, revision: str) -> dict[str, Any]:
    candidate = next(
        (row for row in artifact_history(package, kind) if str(row.get("revision")) == revision),
        None,
    )
    if candidate is None:
        raise ValueError(f"{kind.title()} candidate not found")
    return candidate


def _dialogue_with_chapters(dialogue: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    mapping = {str(key): str(value) for key, value in review.get("spanChapterIds", {}).items()}
    spans = list(dialogue.get("spans", []))
    if set(mapping) != {str(row.get("id")) for row in spans}:
        raise ChapterContractError("Accepted Review must assign every Dialogue span to one chapter")
    chapter_dialogue = {
        **dialogue,
        "spans": [{**row, "chapterId": mapping[str(row["id"])]} for row in spans],
    }
    return apply_review_render_policies(chapter_dialogue, review)


def _accept_voice_revisions(
    candidate: dict[str, Any], decisions: list[dict[str, Any]], revision: str
) -> dict[str, Any]:
    required = [candidate.get("narrator"), *candidate.get("identities", [])]
    required = [row for row in required if isinstance(row, dict)]
    required_by_id = {str(row["characterId"]): row for row in required}
    requested: dict[str, dict[str, Any]] = {}
    for raw in decisions:
        row = dict(raw)
        character_id = str(row.get("characterId", ""))
        if not character_id or character_id in requested:
            raise CastContractError("Each voice decision requires one unique characterId")
        requested[character_id] = row
    if set(requested) != set(required_by_id):
        raise CastContractError("Choose one voice route for every required cast identity")

    accepted = {**candidate, "revision": revision, "status": "accepted", "phase": "accepted"}
    accepted_by_id: dict[str, dict[str, Any]] = {}
    layered: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for raw in required:
        row = dict(raw)
        character_id = str(row["characterId"])
        decision = requested[character_id]
        route = decision.get("voiceRoute")
        route_kind = str(route.get("kind", "")) if isinstance(route, dict) else "dedicated"
        if route_kind == "layered":
            if row.get("category") != "group":
                raise CastContractError("Only a group can layer existing cast voices")
            raw_member_ids = route.get("characterIds")
            if not isinstance(raw_member_ids, list):
                raise CastContractError("A layered group requires selected cast voices")
            member_ids = [str(value) for value in raw_member_ids if str(value)]
            if len(member_ids) < 2 or len(set(member_ids)) != len(member_ids):
                raise CastContractError("A layered group requires at least two unique cast voices")
            if character_id in member_ids:
                raise CastContractError("A group cannot layer its own voice")
            route = {"kind": "layered", "characterIds": member_ids}
            layered.append((row, route))
            continue
        if route_kind != "dedicated":
            raise CastContractError(f"Unsupported voice route for {row.get('name', character_id)}")

        selected_revision = str(decision.get("voiceRevision", ""))
        if not selected_revision:
            raise CastContractError(
                f"Select one exact audition for {row.get('name', character_id)}"
            )
        candidates = [
            voice_candidate
            for voice_candidate in row.get("voiceCandidates", [])
            if isinstance(voice_candidate, dict)
        ]
        if not candidates and row.get("voicePreviewRevision"):
            candidates = [
                {
                    "revision": row.get("voicePreviewRevision"),
                    "previewUrl": row.get("previewUrl"),
                    "referenceText": row.get("referenceText"),
                    "direction": row.get("voiceDirection"),
                    "voiceSettings": row.get("voiceSettings"),
                }
            ]
        selected = next(
            (
                voice_candidate
                for voice_candidate in candidates
                if str(voice_candidate.get("revision", "")) == selected_revision
            ),
            None,
        )
        if selected is None:
            raise CastContractError(
                f"Selected audition is unavailable for {row.get('name', character_id)}"
            )
        reference_text = str(selected.get("referenceText", "")).strip()
        reference_mode = str(
            selected.get("referenceMode") or "transcript-conditioned"
        ).strip()
        if reference_mode not in {"transcript-conditioned", "speaker-embedding"}:
            raise CastContractError(
                f"Voice audition has an unsupported reference mode for "
                f"{row.get('name', character_id)}"
            )
        if reference_mode == "transcript-conditioned" and not reference_text:
            raise CastContractError(
                f"Voice audition is incomplete for {row.get('name', character_id)}"
            )
        row.update(
            {
                "voicePreviewRevision": selected_revision,
                "previewUrl": selected.get("previewUrl"),
                "referenceText": reference_text or None,
                "referenceMode": reference_mode,
                "referenceAudio": str(
                    selected.get("referenceAudio")
                    or Path("voices") / character_id / f"{selected_revision}.wav"
                ),
                "voiceDirection": selected.get("direction") or row.get("voiceDirection"),
                "voiceSettings": selected.get("voiceSettings") or row.get("voiceSettings"),
                "voiceAccepted": True,
                "acceptedVoiceRevision": selected_revision,
                "voiceRevision": selected_revision,
            }
        )
        if row.get("category") == "group":
            row["voiceRoute"] = {"kind": "dedicated"}
        else:
            row.pop("voiceRoute", None)
        accepted_by_id[character_id] = row

    for row, route in layered:
        character_id = str(row["characterId"])
        for member_id in route["characterIds"]:
            member = required_by_id.get(member_id)
            if member is None or member.get("category") != "character":
                raise CastContractError(
                    f"Layered group {row.get('name', character_id)} references an unavailable character"
                )
            if member_id not in accepted_by_id:
                raise CastContractError("Layered groups cannot contain another layered group")
        row.update({"voiceRoute": route, "voiceAccepted": True})
        row.pop("acceptedVoiceRevision", None)
        row.pop("voiceRevision", None)
        row.pop("referenceAudio", None)
        accepted_by_id[character_id] = row

    narrator = candidate.get("narrator")
    accepted["narrator"] = (
        accepted_by_id[str(narrator["characterId"])] if isinstance(narrator, dict) else None
    )
    accepted["identities"] = [
        accepted_by_id[str(row["characterId"])] for row in candidate.get("identities", [])
    ]
    blockers = cast_progression_blockers(accepted)
    if blockers:
        raise CastContractError("; ".join(blockers))
    return accepted


def _chapter_display_title(chapter_id: str) -> str:
    words = chapter_id.replace("_", " ").replace("-", " ").split()
    return " ".join(word if word.isdigit() else word.capitalize() for word in words) or "Chapter"


def _matching_failed_job(
    rows: list[Job], kind: str, payload: dict[str, object]
) -> Job | None:
    """Return the latest failed resumable job with exactly the same immutable inputs."""

    expected = {key: value for key, value in payload.items() if key != "_job_id"}
    candidates = [
        row
        for row in rows
        if row.kind == kind
        and {key: value for key, value in row.payload.items() if key != "_job_id"}
        == expected
    ]
    latest = max(candidates, key=lambda row: row.created_at, default=None)
    return latest if latest and latest.status == JobStatus.FAILED else None


def _recoverable_stages(rows: list[Job], book_id: str) -> dict[str, dict[str, object]]:
    """Expose only the latest failed resumable stage; never leak provider diagnostics."""

    recoverable: dict[str, dict[str, object]] = {}
    for stage in (WizardStage.CAST, WizardStage.GENERATE):
        candidates = [
            row
            for row in rows
            if row.kind == f"v2:{stage.value}"
            and row.payload.get("book_id") == book_id
        ]
        latest = max(candidates, key=lambda row: row.created_at, default=None)
        if latest is not None and latest.status == JobStatus.FAILED:
            settings = latest.payload.get("settings")
            settings = settings if isinstance(settings, dict) else {}
            recoverable[stage.value] = {
                "attempt": latest.attempt,
                "message": "Completed work is saved. Continue this step to resume.",
                "modelId": settings.get("voiceModel"),
                "language": settings.get("language"),
                "proposalRevision": settings.get("proposalRevision"),
            }
    return recoverable
