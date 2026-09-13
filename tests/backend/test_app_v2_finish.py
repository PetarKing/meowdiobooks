import json
import time
from datetime import timedelta
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas
from scipy.io import wavfile

from meowdiobooks.backend.app_v2 import (
    _audition_line,
    _cast_with_line_counts,
    _accept_voice_revisions,
    _generated_chapters,
    _rebase_accepted_cast,
    _matching_failed_job,
    _recoverable_stages,
    _voice_sharing_policy_for_model,
    create_app_v2,
)
from meowdiobooks.backend.artifacts import active_artifacts, read_artifact, write_artifact
from meowdiobooks.backend.languages import shared_audition_line
from meowdiobooks.backend.tts_v2 import (
    TTSContractError,
    _assemble_chapter_wav,
    _float32_mono_wav_header,
    render_plan_audio,
)
from meowdiobooks.backend.transcription import TranscriptionDraft
from meowdiobooks.backend.voice_sharing import VoiceSharingPolicy
from meowdiobooks.backend.models import Job, JobStatus


def test_model_specific_voice_sharing_can_disable_reuse_without_changing_default():
    default = VoiceSharingPolicy(dedicated_dialogue_coverage=0.8)

    assert _voice_sharing_policy_for_model("studio", default, None) is default
    assert (
        _voice_sharing_policy_for_model(
            "balanced",
            default,
            lambda model_id: None if model_id == "balanced" else default,
        )
        is None
    )


def _pdf() -> bytes:
    output = BytesIO()
    canvas = Canvas(output)
    canvas.drawString(72, 760, "Chapter I")
    canvas.save()
    return output.getvalue()


def _wait(client: TestClient, job_id: str) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_voice_transcription_uses_provider_safe_public_error(tmp_path, monkeypatch):
    class ProviderFailure(RuntimeError):
        public_message = "Voice transcription was interrupted. Try again."

    def fail_transcription(_repo_root, _book_id, _sample_path):
        raise ProviderFailure("private provider diagnostics")

    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.normalize_voice_sample",
        lambda _raw, _filename: (b"normalized-voice", 4.0),
    )

    with TestClient(
        create_app_v2(tmp_path, voice_sample_transcriber=fail_transcription)
    ) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        response = client.post(
            f"/api/books/{imported['book']['id']}/voice-samples/transcribe",
            files={"file": ("voice.wav", b"voice", "audio/wav")},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "Voice transcription was interrupted. Try again."
    assert "private provider diagnostics" not in response.text


def _process(client: TestClient, book_id: str, stage: str, settings: dict) -> dict:
    response = client.post(
        f"/api/books/{book_id}/stages/{stage}/process", json={"settings": settings}
    )
    assert response.status_code == 202, response.text
    job = _wait(client, response.json()["id"])
    assert job["status"] == "succeeded", job
    return job["result"]


def _accept(client: TestClient, book_id: str, stage: str, revision: str, decisions=None):
    return client.post(
        f"/api/books/{book_id}/stages/{stage}/accept",
        json={"revision": revision, "decisions": decisions or []},
    )


def _seed_reviewed_transcript(tmp_path, book_id: str):
    package = tmp_path / "packages" / book_id
    block = {"id": "p1-b1", "page": 1, "text": "Hello"}
    _, extraction = write_artifact(
        package,
        "extraction",
        {"revision": "extract-1", "blocks": [block], "pages": [], "boundaryCandidates": []},
    )
    span = {
        "id": "span-1",
        "blockId": "p1-b1",
        "page": 1,
        "sourceStart": 0,
        "sourceEnd": 5,
        "source": "Hello",
        "text": "Hello",
        "renderRole": "dialogue",
        "sourceSpeakerLabel": "Alice",
        "speakerStatus": "explicit",
    }
    _, dialogue = write_artifact(
        package,
        "dialogue",
        {
            "revision": "dialogue-1",
            "extractionRevision": extraction["revision"],
            "spans": [span],
        },
    )
    _, review = write_artifact(
        package,
        "review",
        {
            "revision": "review-1",
            "dialogueRevision": dialogue["revision"],
            "canStartCast": True,
            "blockers": [],
            "chapters": [
                {
                    "id": "complete-document",
                    "title": "Complete document",
                    "sourceSpanIds": ["span-1"],
                }
            ],
            "spanChapterIds": {"span-1": "complete-document"},
        },
    )
    return package, dialogue, review


def test_snapshot_exposes_malformed_dialogue_recovery_without_mutating_artifact(tmp_path):
    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package = tmp_path / "packages" / book_id
        _, extraction = write_artifact(
            package,
            "extraction",
            {"revision": "extract-recovery", "blocks": [], "pages": []},
        )
        path, _dialogue = write_artifact(
            package,
            "dialogue",
            {
                "revision": "dialogue-recovery",
                "extractionRevision": extraction["revision"],
                "spans": [
                    {
                        "id": "span:p48-b2:1373-1372",
                        "blockId": "p48-b2",
                        "page": 48,
                        "sourceStart": 1366,
                        "sourceEnd": 1373,
                        "spokenStart": 1373,
                        "spokenEnd": 1372,
                        "source": 'Bob: " ',
                        "text": "",
                        "renderRole": "dialogue",
                    }
                ],
            },
        )
        before = path.read_text(encoding="utf-8")

        snapshot = client.get(f"/api/books/{book_id}/snapshot")

        assert snapshot.status_code == 200
        assert snapshot.json()["dialogueRecovery"] == {
            "kind": "malformed-playable-span",
            "spanIds": ["span:p48-b2:1373-1372"],
            "page": 48,
            "availableActions": ["rerun-dialogue"],
        }
        assert path.read_text(encoding="utf-8") == before

    with TestClient(create_app_v2(tmp_path)) as restarted_client:
        restarted_snapshot = restarted_client.get(f"/api/books/{book_id}/snapshot")

        assert restarted_snapshot.status_code == 200
        assert restarted_snapshot.json()["dialogueRecovery"] == snapshot.json()[
            "dialogueRecovery"
        ]
        assert path.read_text(encoding="utf-8") == before


def test_failed_cast_with_identical_inputs_is_resumable_and_exposed_safely():
    payload = {
        "book_id": "book-1",
        "settings": {
            "proposalRevision": "cast-proposal-1",
            "voiceModel": "qwen-audio",
            "language": "english",
        },
        "workflow_version": "2",
    }
    failed = Job(
        kind="v2:cast",
        payload=payload,
        status=JobStatus.FAILED,
        attempt=3,
        error="PrivateProviderError: secret diagnostics",
    )

    assert _matching_failed_job([failed], "v2:cast", payload) is failed
    assert _recoverable_stages([failed], "book-1") == {
        "cast": {
            "attempt": 3,
            "message": "Completed work is saved. Continue this step to resume.",
            "modelId": "qwen-audio",
            "language": "english",
            "proposalRevision": "cast-proposal-1",
        }
    }

    succeeded = Job(
        kind="v2:cast",
        payload=payload,
        status=JobStatus.SUCCEEDED,
        attempt=4,
    )
    succeeded.created_at = failed.created_at + timedelta(seconds=1)
    assert _recoverable_stages([failed, succeeded], "book-1") == {}


@pytest.mark.uses_audio_decoder
def test_voice_sample_upload_generates_audition_and_is_deleted_with_book(tmp_path):
    generated: dict[str, object] = {}
    transcribed: dict[str, object] = {}

    def clone_audition(
        repo_root,
        package,
        book_id,
        character_id,
        voice_revision,
        reference_audio,
        reference_text,
        text,
        language,
        model_id,
    ):
        generated.update(
            reference_audio=reference_audio,
            reference_text=reference_text,
            text=text,
            language=language,
            model_id=model_id,
            package=package,
            book_id=book_id,
            character_id=character_id,
            voice_revision=voice_revision,
        )
        output = BytesIO()
        timeline = np.arange(24_000, dtype=np.float32) / 24_000
        wavfile.write(
            output,
            24_000,
            (0.15 * np.sin(2 * np.pi * 440 * timeline)).astype(np.float32),
        )
        return output.getvalue()

    def draft_transcript(repo_root, book_id, sample_path):
        rate, audio = wavfile.read(sample_path)
        transcribed.update(
            repo_root=repo_root,
            book_id=book_id,
            rate=rate,
            samples=audio.shape[0],
        )
        return TranscriptionDraft("Alice says these exact sample words.", "English")

    with TestClient(
        create_app_v2(
            tmp_path,
            voice_sample_auditioner=clone_audition,
            voice_sample_transcriber=draft_transcript,
        )
    ) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package = tmp_path / "packages" / book_id
        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        voice_model = snapshot["voiceSelection"]["modelId"]
        voice_recipe_version = next(
            row["recipeVersion"]
            for row in snapshot["voiceModels"]
            if row["id"] == voice_model
        )
        _, cast = write_artifact(
            package,
            "cast",
            {
                "revision": "cast-upload-1",
                "phase": "audition-review",
                "status": "needs-voice-review",
                "language": "english",
                "voiceModel": voice_model,
                "auditionPackRecipeVersion": voice_recipe_version,
                "narrator": {
                    "characterId": "narrator",
                    "name": "Narrator",
                    "voicePreviewRevision": "narrator-1",
                    "voiceCandidates": [
                        {
                            "revision": "narrator-1",
                            "previewUrl": "/narrator.wav",
                            "referenceText": "This is the narrator.",
                            "direction": "Warm narrator.",
                        }
                    ],
                },
                "identities": [
                    {
                        "characterId": "alice",
                        "name": "Alice",
                        "category": "character",
                        "voicePreviewRevision": "alice-1",
                        "voiceCandidates": [
                            {
                                "revision": "alice-1",
                                "previewUrl": "/alice.wav",
                                "referenceText": "This is Alice.",
                                "direction": "Bright.",
                            }
                        ],
                    }
                ],
            },
            publish=False,
        )
        source = BytesIO()
        timeline = np.arange(24_000 * 4, dtype=np.float32) / 24_000
        wavfile.write(source, 24_000, (0.2 * np.sin(2 * np.pi * 220 * timeline)).astype(np.float32))

        transcript_response = client.post(
            f"/api/books/{book_id}/voice-samples/transcribe",
            files={"file": ("alice.wav", source.getvalue(), "audio/wav")},
        )
        assert transcript_response.status_code == 200, transcript_response.text
        assert transcript_response.json() == {
            "text": "Alice says these exact sample words.",
            "language": "English",
        }
        assert transcribed == {
            "repo_root": Path(__file__).resolve().parents[2],
            "book_id": book_id,
            "rate": 24_000,
            "samples": 24_000 * 4,
        }

        response = client.post(
            f"/api/books/{book_id}/stages/cast/candidates/{cast['revision']}"
            "/voices/alice/upload",
            data={"reference_text": "Alice says these exact sample words."},
            files={"file": ("alice.wav", source.getvalue(), "audio/wav")},
        )

        assert response.status_code == 201, response.text
        uploaded_cast = response.json()
        alice = uploaded_cast["identities"][0]
        uploaded = alice["voiceCandidates"][-1]
        assert uploaded == {
            "revision": alice["voicePreviewRevision"],
            "previewUrl": alice["previewUrl"],
            "previewText": "This is Alice.",
            "referenceText": "Alice says these exact sample words.",
            "referenceAudio": (
                f"voices/alice/{alice['voicePreviewRevision']}.reference.wav"
            ),
            "direction": "Cloned from uploaded voice sample",
            "source": "upload",
            "referenceMode": "transcript-conditioned",
            "durationSeconds": 4.0,
            "parentRevision": "alice-1",
        }
        audition_rate, audition_audio = wavfile.read(
            package / "voices" / "alice" / f"{uploaded['revision']}.wav"
        )
        reference_rate, reference_audio = wavfile.read(package / uploaded["referenceAudio"])
        assert audition_rate == reference_rate == 24_000
        assert audition_audio.shape == (24_000,)
        assert reference_audio.shape == (24_000 * 4,)
        assert generated["reference_audio"] == package / uploaded["referenceAudio"]
        assert generated["reference_text"] == "Alice says these exact sample words."
        assert generated["text"] == "This is Alice."
        assert generated["language"] == "english"
        assert generated["package"] == package
        assert generated["book_id"] == book_id
        assert generated["character_id"] == "alice"
        assert generated["voice_revision"] == uploaded["revision"]

        accepted = _accept_voice_revisions(
            uploaded_cast,
            [
                {"characterId": "narrator", "voiceRevision": "narrator-1"},
                {"characterId": "alice", "voiceRevision": uploaded["revision"]},
            ],
            "cast-accepted",
        )
        assert accepted["identities"][0]["referenceMode"] == "transcript-conditioned"
        assert accepted["identities"][0]["referenceText"] == (
            "Alice says these exact sample words."
        )
        assert accepted["identities"][0]["referenceAudio"] == uploaded["referenceAudio"]

        deleted = client.delete(
            f"/api/books/{book_id}/stages/cast/candidates/{uploaded_cast['revision']}"
            "/voices/alice/alice-1"
        )
        assert deleted.status_code == 200, deleted.text
        deleted_cast = deleted.json()
        assert [
            row["revision"] for row in deleted_cast["identities"][0]["voiceCandidates"]
        ] == [uploaded["revision"]]
        refused = client.delete(
            f"/api/books/{book_id}/stages/cast/candidates/{deleted_cast['revision']}"
            f"/voices/alice/{uploaded['revision']}"
        )
        assert refused.status_code == 409
        assert refused.json()["detail"] == "Keep at least one audition"

        assert client.delete(f"/api/books/{book_id}").status_code == 204
        assert not package.exists()


def test_recording_script_split_publishes_ordinary_generation_chapters(tmp_path):
    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package = tmp_path / "packages" / book_id
        spans = [
            {
                "id": f"span-{index}",
                "blockId": f"block-{index}",
                "page": index,
                "sourceStart": 0,
                "sourceEnd": 9_000,
                "source": "A" * 9_000,
                "text": "A" * 9_000,
                "renderRole": "narration",
                "speakerStatus": "not-applicable",
            }
            for index in range(1, 13)
        ]
        _, dialogue = write_artifact(
            package,
            "dialogue",
            {"revision": "dialogue-long", "spans": spans},
        )
        _, review = write_artifact(
            package,
            "review",
            {
                "revision": "review-long",
                "dialogueRevision": dialogue["revision"],
                "canStartCast": True,
                "blockers": [],
                "chapters": [
                    {
                        "id": "complete-document",
                        "title": "Complete document",
                        "startPage": 1,
                        "endPage": 12,
                    }
                ],
                "spanChapterIds": {
                    row["id"]: "complete-document" for row in spans
                },
            },
        )
        write_artifact(
            package,
            "cast",
            {
                "revision": "cast-long",
                "dialogueRevision": dialogue["revision"],
                "reviewRevision": review["revision"],
                "labelToCharacterId": {},
            },
        )

        prepared = client.post(f"/api/books/{book_id}/recording-script/prepare").json()
        response = client.post(
            f"/api/books/{book_id}/recording-script/chapters/complete-document/split"
        )

        assert response.status_code == 200, response.text
        split = response.json()
        assert split["revision"] != prepared["revision"]
        assert [row["id"] for row in split["chapters"]] == [
            "complete-document--part-01",
            "complete-document--part-02",
            "complete-document--part-03",
            "complete-document--part-04",
        ]
        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert snapshot["chapters"] == split["chapters"]
        assert snapshot["activeArtifacts"]["cast"] == "cast-long"
        assert snapshot["activeArtifacts"]["script"] == split["revision"]


def test_cast_to_generate_gates_exact_voices_and_uses_only_v2_artifacts(tmp_path, monkeypatch):
    proposal = {
        "status": "ready",
        "dossiers": [{"label": "Alice", "occurrenceCount": 1, "examples": []}],
        "fuzzyCandidates": [],
        "globalLabelLedger": "Alice\t1\tfirst:0",
        "proposals": [
            {
                "label": "Alice",
                "category": "character",
                "canonicalName": "Alice",
                "aliases": [],
                "competingLabels": [],
                "reason": "The explicit label is stable in context.",
                "reviewRequired": False,
            }
        ],
        "reconciliationConflicts": [],
        "processing": {"labels": 1, "batches": 1, "model": "test"},
    }
    monkeypatch.setattr("meowdiobooks.backend.app_v2.propose_cast", lambda *_args: proposal)

    profile_batches: list[list[str]] = []

    def fake_voice_settings(
        _repo, identities, _dossiers, _spans, _report, **_kwargs
    ):
        assert "generate_audition_line" not in _kwargs
        assert "language" not in _kwargs
        profile_batches.append([str(row["characterId"]) for row in identities])
        narrator = {
            "presentation": "unspecified",
            "age": "adult",
            "tone": "warm",
            "pitch": "medium",
            "pace": "measured",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Clear audiobook narrator.",
        }
        character = {
            "presentation": "feminine",
            "age": "young-adult",
            "tone": "bright",
            "pitch": "medium",
            "pace": "natural",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Bright, curious young voice.",
        }
        return {"narrator": narrator, **{row["characterId"]: character for row in identities}}

    monkeypatch.setattr("meowdiobooks.backend.app_v2.suggest_voice_settings", fake_voice_settings)

    audition_batches = []
    fail_audition_once = True

    def fake_auditions(_repo, package, _book_id, characters, report, _language, _model_id):
        nonlocal fail_audition_once
        if fail_audition_once:
            fail_audition_once = False
            raise RuntimeError("simulated provider failure after Luna profiling")
        audition_batches.append([row["id"] for row in characters])
        for row in characters:
            candidates = list(row.get("voiceCandidates", []))
            revision = f"voice-{row['id']}-{len(candidates) + 1}"
            path = package / "voices" / row["id"] / f"{revision}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"RIFF-test")
            row.update(
                {
                    "voicePreviewRevision": revision,
                    "previewUrl": f"/voice/{revision}",
                    "referenceText": row["previewLine"],
                    "voice": row["voiceDirection"],
                    "voiceCandidates": [
                        *candidates,
                        {
                            "revision": revision,
                            "previewUrl": f"/voice/{revision}",
                            "referenceText": row["previewLine"],
                            "direction": row["voiceDirection"],
                        },
                    ],
                }
            )
        report(100, "done")
        return characters

    monkeypatch.setattr("meowdiobooks.backend.app_v2.generate_cast_previews", fake_auditions)
    render_calls = []

    def fake_render(_repo, _package, _book_id, plan, _language, report, _model_id):
        render_calls.append(plan)
        report(100, "done")
        return [{"chapterId": "complete-document", "revision": "audio-1"}]

    monkeypatch.setattr("meowdiobooks.backend.app_v2.render_plan_audio", fake_render)

    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package, _, _ = _seed_reviewed_transcript(tmp_path, book_id)

        identity = _process(client, book_id, "cast", {})
        blocked = _accept(client, book_id, "cast", identity["revision"])
        assert blocked.status_code == 409
        assert "generate auditions" in blocked.json()["detail"]

        failed_response = client.post(
            f"/api/books/{book_id}/stages/cast/process",
            json={
                "settings": {
                    "proposalRevision": identity["revision"],
                    "language": "english",
                }
            },
        )
        failed = _wait(client, failed_response.json()["id"])
        assert failed["status"] == "failed"
        assert len(profile_batches) == 1
        assert len(list((package / ".checkpoints" / "cast-voice-profiles").glob("*.json"))) == 1
        assert client.get(f"/api/books/{book_id}/snapshot").json()["pendingCandidates"][
            "cast"
        ]["revision"] == identity["revision"]

        audition = _process(
            client,
            book_id,
            "cast",
            {"proposalRevision": identity["revision"], "language": "english"},
        )
        assert len(profile_batches) == 1
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{audition['revision']}"
        ).json()
        assert candidate["narrator"]["referenceText"].startswith(
            "This is the voice of Narrator. The bright morning"
        )
        assert len(candidate["narrator"]["referenceText"].split()) >= 35
        assert candidate["narrator"]["lineCount"] == 0
        assert candidate["identities"][0]["referenceText"].startswith(
            "This is the voice of Alice. The bright morning"
        )
        assert len(candidate["identities"][0]["referenceText"].split()) >= 35
        assert candidate["identities"][0]["lineCount"] == 1
        original_narrator_revision = candidate["narrator"]["voicePreviewRevision"]
        original_alice_revision = candidate["identities"][0]["voicePreviewRevision"]
        narrated = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": identity["revision"],
                "identityDecisions": [
                    {
                        "label": "Alice",
                        "category": "narrator",
                        "canonicalName": "",
                        "aliases": [],
                        "primaryLabel": "narrator",
                    }
                ],
                "language": "english",
            },
        )
        narrated_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{narrated['revision']}"
        ).json()
        assert narrated_candidate["identities"] == []
        assert narrated_candidate["labelToCharacterId"] == {"Alice": None}
        batches_before_label_edit = len(audition_batches)
        profiles_before_label_edit = len(profile_batches)
        alice_settings_before_edit = candidate["identities"][0]["voiceSettings"]
        edited = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": audition["revision"],
                "identityDecisions": [
                    {
                        "label": "Alice",
                        "category": "character",
                        "canonicalName": "Alicia",
                        "aliases": [],
                        "primaryLabel": "Alice",
                    }
                ],
                "language": "english",
            },
        )
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{edited['revision']}"
        ).json()
        assert candidate["identities"][0]["name"] == "Alicia"
        assert len(audition_batches) == batches_before_label_edit
        assert len(profile_batches) == profiles_before_label_edit
        assert candidate["identities"][0]["voiceSettings"] == alice_settings_before_edit
        assert candidate["narrator"]["voicePreviewRevision"] == original_narrator_revision
        assert candidate["identities"][0]["voicePreviewRevision"] == original_alice_revision
        missing = _accept(client, book_id, "cast", edited["revision"], [])
        assert missing.status_code == 409
        alice_id = candidate["identities"][0]["characterId"]
        regenerated = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": edited["revision"],
                "characterId": alice_id,
                "voiceSettings": {
                    **candidate["identities"][0]["voiceSettings"],
                    "pace": "brisk",
                    "description": "Brisk, dry, and quietly amused.",
                },
            },
        )
        regenerated_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{regenerated['revision']}"
        ).json()
        assert (
            regenerated_candidate["narrator"]["voicePreviewRevision"]
            == candidate["narrator"]["voicePreviewRevision"]
        )
        assert (
            regenerated_candidate["identities"][0]["voicePreviewRevision"]
            != candidate["identities"][0]["voicePreviewRevision"]
        )
        assert "brisk pace" in regenerated_candidate["identities"][0]["voiceDirection"]
        assert (
            "Brisk, dry, and quietly amused"
            in regenerated_candidate["identities"][0]["voiceDirection"]
        )
        assert len(regenerated_candidate["identities"][0]["voiceCandidates"]) == 1
        assert not (
            package / "voices" / alice_id / f"{original_alice_revision}.wav"
        ).exists()
        stale_decisions = [
            {
                "characterId": row["characterId"],
                "voiceRevision": row["voicePreviewRevision"],
            }
            for row in [candidate["narrator"], *candidate["identities"]]
        ]
        unavailable_decisions = [*stale_decisions]
        unavailable_decisions[-1] = {
            **unavailable_decisions[-1],
            "voiceRevision": "not-a-candidate",
        }
        assert (
            _accept(
                client,
                book_id,
                "cast",
                regenerated["revision"],
                unavailable_decisions,
            ).status_code
            == 409
        )
        assert (
            _accept(client, book_id, "cast", regenerated["revision"], stale_decisions).status_code
            == 409
        )
        current_decisions = [
            {
                "characterId": row["characterId"],
                "voiceRevision": row["voicePreviewRevision"],
            }
            for row in [
                regenerated_candidate["narrator"],
                *regenerated_candidate["identities"],
            ]
        ]
        assert (
            _accept(client, book_id, "cast", regenerated["revision"], current_decisions).status_code
            == 200
        )

        accepted_cast_revision = read_artifact(package, "cast")["revision"]
        accepted_snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert "cast" not in accepted_snapshot["pendingCandidates"]
        reclassified = _process(client, book_id, "cast", {"forceReclassify": True})
        reclassified_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{reclassified['revision']}"
        ).json()
        assert reclassified_candidate["phase"] == "identity-review"
        assert reclassified_candidate["dialogueRevision"] == "dialogue-1"
        assert reclassified_candidate["reviewRevision"] == "review-1"
        assert "reusedFromRevision" not in reclassified_candidate
        assert read_artifact(package, "cast")["revision"] == accepted_cast_revision

        prepared = client.post(f"/api/books/{book_id}/recording-script/prepare")
        assert prepared.status_code == 200, prepared.text
        script_revision = prepared.json()["revision"]
        assert prepared.json()["status"] == "ready"
        assert client.post(f"/api/books/{book_id}/recording-script/prepare").json()[
            "revision"
        ] == script_revision
        prepared_snapshot = client.get(f"/api/books/{book_id}/snapshot")
        assert prepared_snapshot.status_code == 200, prepared_snapshot.text
        assert prepared_snapshot.json()["recordingScript"]["revision"] == script_revision
        assert prepared_snapshot.json()["history"]["script"] == [
            {
                "revision": script_revision,
                "status": "accepted",
                "extractionRevision": None,
                "dialogueRevision": None,
                "summary": prepared.json()["summary"],
            }
        ]

        generation = _process(
            client,
            book_id,
            "generate",
            {"chapterIds": ["complete-document"], "language": "english"},
        )

        assert generation["chapters"][0]["revision"] == "audio-1"
        completed_book = client.get(f"/api/books/{book_id}").json()
        assert completed_book["stage"] == "generate"
        assert completed_book["accepted_stage_revisions"][-1]["stage"] == "generate"
        assert active_artifacts(package)["script"].endswith(f"/{script_revision}.json")
        assert render_calls[0]["chapters"][0]["segments"][0]["text"] == "Hello"
        assert render_calls[0]["chapters"][0]["segments"][0]["effectiveSpeaker"] == "Alicia"
        assert (
            render_calls[0]["chapters"][0]["segments"][0]["voiceRevision"]
            == regenerated_candidate["identities"][0]["voicePreviewRevision"]
        )
        assert render_calls[0]["sourceCoverage"] == {"status": "exact", "sourceSpanCount": 1}


def test_opt_in_profile_audition_lines_are_stored_and_reused_for_regeneration(tmp_path):
    proposal = {
        "status": "ready",
        "dossiers": [
            {"label": "Alice", "occurrenceCount": 1, "examples": []},
            {"label": "Bob", "occurrenceCount": 0, "examples": []},
        ],
        "fuzzyCandidates": [],
        "globalLabelLedger": "Alice\t1\tfirst:0",
        "proposals": [
            {
                "label": "Alice",
                "category": "character",
                "canonicalName": "Alice",
                "aliases": [],
                "competingLabels": [],
                "reason": "The explicit label is stable in context.",
                "reviewRequired": False,
            },
            {
                "label": "Bob",
                "category": "character",
                "canonicalName": "Bob",
                "aliases": [],
                "competingLabels": [],
                "reason": "The explicit label is stable in context.",
                "reviewRequired": False,
            },
        ],
        "reconciliationConflicts": [],
        "processing": {"labels": 1, "batches": 1, "model": "test"},
    }
    settings = {
        "presentation": "unspecified",
        "age": "adult",
        "tone": "warm",
        "pitch": "medium",
        "pace": "measured",
        "energy": "balanced",
        "accent": "unspecified",
        "description": "Clear and natural.",
    }
    profiler_calls = []

    def profile(_repo, identities, _dossiers, _spans, _report, **kwargs):
        profiler_calls.append(kwargs)
        return {
            "narrator": {
                **settings,
                "auditionLine": (
                    "Night settled quietly over the harbour as the final lanterns flickered "
                    "along the quay. Far beyond the breakwater, a patient bell marked the "
                    "hours, and every darkened window seemed to hold a secret."
                ),
            },
            **{
                str(row["characterId"]): {
                    **settings,
                    "auditionLine": (
                        (
                            "I kept the silver key, though nobody asked me why. Perhaps tomorrow "
                            "I will cross the square, unlock the weathered garden door, and finally "
                            "discover which promise has been waiting there for me."
                        )
                        if row["name"] == "Alice"
                        else "!!!"
                    ),
                }
                for row in identities
            },
        }

    audition_inputs = []

    def audition(_repo, package, _book_id, characters, report, _language, _model_id):
        audition_inputs.append([dict(row) for row in characters])
        for row in characters:
            revision = f"voice-{row['id']}-{len(row.get('voiceCandidates', [])) + 1}"
            path = package / "voices" / row["id"] / f"{revision}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"RIFF-test")
            row.update(
                {
                    "voicePreviewRevision": revision,
                    "previewUrl": f"/voice/{revision}",
                    "referenceText": row["previewLine"],
                    "voice": row["voiceDirection"],
                    "voiceCandidates": [
                        *row.get("voiceCandidates", []),
                        {
                            "revision": revision,
                            "previewUrl": f"/voice/{revision}",
                            "referenceText": row["previewLine"],
                            "direction": row["voiceDirection"],
                            "voiceSettings": row["voiceSettings"],
                        },
                    ],
                }
            )
        report(100, "done")
        return characters

    with TestClient(
        create_app_v2(
            tmp_path,
            cast_proposer=lambda *_args: proposal,
            voice_profiler=profile,
            voice_auditioner=audition,
            generate_voice_audition_lines=True,
        )
    ) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        _seed_reviewed_transcript(tmp_path, book_id)

        identity = _process(client, book_id, "cast", {})
        audition_result = _process(
            client,
            book_id,
            "cast",
            {"proposalRevision": identity["revision"], "language": "english"},
        )
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{audition_result['revision']}"
        ).json()
        alice = next(row for row in candidate["identities"] if row["name"] == "Alice")
        bob = next(row for row in candidate["identities"] if row["name"] == "Bob")

        assert profiler_calls == [
            {
                "include_narrator": True,
                "generate_audition_line": True,
                "language": "english",
            }
        ]
        assert candidate["narrator"]["auditionLine"] == (
            "Night settled quietly over the harbour as the final lanterns flickered along "
            "the quay. Far beyond the breakwater, a patient bell marked the hours, and every "
            "darkened window seemed to hold a secret."
        )
        assert candidate["narrator"]["referenceText"] == candidate["narrator"]["auditionLine"]
        assert alice["auditionLine"] == (
            "I kept the silver key, though nobody asked me why. Perhaps tomorrow I will cross "
            "the square, unlock the weathered garden door, and finally discover which promise "
            "has been waiting there for me."
        )
        assert alice["referenceText"] == alice["auditionLine"]
        assert "auditionLine" not in alice["voiceSettings"]
        assert "auditionLine" not in bob
        assert bob["referenceText"] == _audition_line("Bob", "english")
        assert bob["voiceSettings"] == settings

        regenerated = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": audition_result["revision"],
                "characterId": alice["characterId"],
                "voiceSettings": {**alice["voiceSettings"], "pace": "brisk"},
            },
        )
        regenerated_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{regenerated['revision']}"
        ).json()
        decisions = [
            {
                "characterId": row["characterId"],
                "voiceRevision": row["voicePreviewRevision"],
            }
            for row in [
                regenerated_candidate["narrator"],
                *regenerated_candidate["identities"],
            ]
        ]
        accepted = _accept(
            client, book_id, "cast", regenerated["revision"], decisions
        )
        assert accepted.status_code == 200, accepted.text

    regenerated_alice = next(
        row for row in regenerated_candidate["identities"] if row["name"] == "Alice"
    )
    assert regenerated_alice["auditionLine"] == alice["auditionLine"]
    assert regenerated_alice["referenceText"] == alice["auditionLine"]
    assert audition_inputs[-1][0]["previewLine"] == alice["auditionLine"]
    accepted_cast = read_artifact(tmp_path / "packages" / book_id, "cast")
    assert accepted_cast["narrator"]["auditionLine"] == candidate["narrator"]["auditionLine"]
    assert next(
        row for row in accepted_cast["identities"] if row["name"] == "Alice"
    )["auditionLine"] == alice["auditionLine"]
    assert "auditionLine" not in next(
        row for row in accepted_cast["identities"] if row["name"] == "Bob"
    )

    with TestClient(create_app_v2(tmp_path)) as restarted:
        reopened = restarted.get(f"/api/books/{book_id}/snapshot").json()["cast"]

    assert reopened["narrator"]["auditionLine"] == candidate["narrator"]["auditionLine"]
    assert next(row for row in reopened["identities"] if row["name"] == "Alice")[
        "auditionLine"
    ] == alice["auditionLine"]


def test_cast_generates_one_audition_for_compatible_distant_side_characters(tmp_path):
    labels = ["Guard", "Rebel", *(["Major"] * 98)]
    spans = [
        {
            "id": f"span-{index}",
            "blockId": f"block-{index}",
            "sourceStart": 0,
            "sourceEnd": 5,
            "source": "Line.",
            "text": "Line.",
            "renderRole": "dialogue",
            "sourceSpeakerLabel": label,
            "speakerStatus": "explicit",
        }
        for index, label in enumerate(labels)
    ]
    proposal = {
        "status": "ready",
        "dossiers": [
            {"label": "Guard", "occurrenceCount": 1, "examples": []},
            {"label": "Rebel", "occurrenceCount": 1, "examples": []},
            {"label": "Major", "occurrenceCount": 98, "examples": []},
        ],
        "proposals": [
            {
                "label": label,
                "category": "character",
                "canonicalName": label,
                "aliases": [],
                "competingLabels": [],
                "reason": "Explicit label.",
                "reviewRequired": False,
            }
            for label in ("Guard", "Rebel", "Major")
        ],
        "fuzzyCandidates": [],
        "globalLabelLedger": "",
        "reconciliationConflicts": [],
        "processing": {"labels": 3, "batches": 1, "model": "test"},
    }
    settings = {
        "presentation": "masculine",
        "age": "adult",
        "tone": "neutral",
        "pitch": "medium",
        "pace": "natural",
        "energy": "balanced",
        "accent": "unspecified",
        "description": "Natural adult voice.",
    }
    audition_batches: list[list[str]] = []

    def auditions(_repo, package, _book_id, characters, report, _language, _model_id):
        audition_batches.append([str(row["id"]) for row in characters])
        for row in characters:
            candidates = list(row.get("voiceCandidates", []))
            revision = f"voice-{row['id']}-{len(candidates) + 1}"
            path = package / "voices" / row["id"] / f"{revision}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"RIFF-test")
            row.update(
                {
                    "voicePreviewRevision": revision,
                    "previewUrl": f"/voice/{revision}",
                    "referenceText": row["previewLine"],
                    "voice": row["voiceDirection"],
                    "voiceCandidates": [
                        *candidates,
                        {
                            "revision": revision,
                            "previewUrl": f"/voice/{revision}",
                            "referenceText": row["previewLine"],
                            "direction": row["voiceDirection"],
                            "voiceSettings": row["voiceSettings"],
                        }
                    ],
                }
            )
        report(100, "done")
        return characters

    with TestClient(
        create_app_v2(
            tmp_path,
            cast_proposer=lambda *_args: proposal,
            voice_profiler=lambda _repo, identities, *_args, **_kwargs: {
                row["characterId"]: {
                    **settings,
                    "tone": "dark" if row["name"] == "Guard" else "bright",
                    "description": f"Profile designed for {row['name']}.",
                    "auditionLine": (
                        "A restless wind moved over the watchtower while distant bells answered "
                        "from the valley. I held my ground, listened for the returning signal, "
                        "and prepared to carry the warning through the sleeping town."
                    ),
                }
                for row in identities
            },
            voice_auditioner=auditions,
            voice_sharing_policy=VoiceSharingPolicy(
                dedicated_dialogue_coverage=0.8,
                collision_window_turns=8,
                compatibility_fields=("age", "presentation"),
            ),
            generate_voice_audition_lines=True,
        )
    ) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package = tmp_path / "packages" / book_id
        _, extraction = write_artifact(
            package,
            "extraction",
            {"revision": "extract-1", "blocks": [], "pages": [], "boundaryCandidates": []},
        )
        _, dialogue = write_artifact(
            package,
            "dialogue",
            {
                "revision": "dialogue-1",
                "extractionRevision": extraction["revision"],
                "spans": spans,
            },
        )
        chapter_ids = {
            row["id"]: "guard-scene"
            if row["sourceSpeakerLabel"] == "Guard"
            else "rebel-scene"
            if row["sourceSpeakerLabel"] == "Rebel"
            else "main-scene"
            for row in spans
        }
        write_artifact(
            package,
            "review",
            {
                "revision": "review-1",
                "dialogueRevision": dialogue["revision"],
                "canStartCast": True,
                "blockers": [],
                "spanChapterIds": chapter_ids,
            },
        )

        identity = _process(client, book_id, "cast", {})
        audition = _process(
            client,
            book_id,
            "cast",
            {"proposalRevision": identity["revision"], "language": "english"},
        )
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{audition['revision']}"
        ).json()
        decisions = [
            {
                "characterId": row["characterId"],
                "voiceRevision": row["voicePreviewRevision"],
            }
            for row in [candidate["narrator"], *candidate["identities"]]
        ]
        accepted_response = _accept(
            client, book_id, "cast", audition["revision"], decisions
        )
        assert accepted_response.status_code == 200, accepted_response.text
        acceptance = accepted_response.json()["accepted_stage_revisions"][-1]
        assert acceptance["data"] == {
            "artifactRevision": read_artifact(package, "cast")["revision"],
            "sourceCandidateRevision": audition["revision"],
        }
        accepted = read_artifact(package, "cast")

    assert len(audition_batches) == 2
    assert audition_batches[0][0] == "narrator"
    assert len(audition_batches[0]) == 3
    assert len(audition_batches[1]) == 2
    by_name = {row["name"]: row for row in candidate["identities"]}
    assert by_name["Guard"]["voicePreviewRevision"] == by_name["Rebel"][
        "voicePreviewRevision"
    ]
    assert by_name["Guard"]["voiceCandidates"][0]["source"] == "shared"
    assert by_name["Rebel"]["voiceCandidates"][0]["source"] == "shared"
    assert by_name["Guard"]["referenceText"] == shared_audition_line("english")
    assert by_name["Rebel"]["referenceText"] == shared_audition_line("english")
    assert by_name["Guard"]["voiceCandidates"][0]["sharedVoiceGroupId"].startswith(
        "shared-voice-"
    )
    assert by_name["Guard"]["voiceSettings"]["tone"] == "dark"
    assert by_name["Rebel"]["voiceSettings"]["tone"] == "bright"
    assert by_name["Guard"]["voiceCandidates"][0]["voiceSettings"]["tone"] == "dark"
    assert by_name["Rebel"]["voiceCandidates"][0]["voiceSettings"]["tone"] == "bright"
    assert by_name["Guard"]["referenceAudio"] == by_name["Rebel"]["referenceAudio"]
    assert by_name["Major"]["voicePreviewRevision"].startswith("voice-character-")
    accepted_by_name = {row["name"]: row for row in accepted["identities"]}
    assert accepted_by_name["Guard"]["voiceAccepted"] is True
    assert accepted_by_name["Rebel"]["voiceSettings"]["tone"] == "bright"
    assert accepted_by_name["Guard"]["referenceAudio"] == accepted_by_name["Rebel"][
        "referenceAudio"
    ]


def test_tts_v2_atomically_publishes_metadata_from_compiled_segment(tmp_path, monkeypatch):
    class Result:
        audio = np.ones(100, dtype=np.float32) * 0.1

    class Model:
        sample_rate = 1_000

        def generate(self, *_args, **_kwargs):
            return [Result()]

    monkeypatch.setattr(
        "meowdiobooks.backend.tts_v2._load_model",
        lambda _repo, _model_id: (Model(), lambda: None),
    )
    package = tmp_path / "package"
    stale_staging = package / "audio" / "old-chapter" / ".interrupted.staging"
    stale_staging.mkdir(parents=True)
    (stale_staging / "partial.wav").write_bytes(b"partial")
    reference = package / "voices" / "alice" / "voice-1.wav"
    reference.parent.mkdir(parents=True)
    reference.write_bytes(b"reference")
    plan = {
        "contract": "meowdiobooks.render-plan.v2",
        "inputRevisions": {"dialogue": "d1", "cast": "c1", "script": "s1"},
        "chapters": [
            {
                "chapterId": "chapter-1",
                "omissions": [],
                "segments": [
                    {
                        "id": "segment-1",
                        "text": "Hello.",
                        "sourceSpanIds": ["span-1"],
                        "effectiveCharacterId": "alice",
                        "referenceAudio": "voices/alice/voice-1.wav",
                        "referenceText": "Hello.",
                        "mixGroupId": "joint-1",
                    },
                    {
                        "id": "segment-2",
                        "text": "Hello.",
                        "sourceSpanIds": ["span-1"],
                        "effectiveCharacterId": "bob",
                        "referenceAudio": "voices/alice/voice-1.wav",
                        "referenceText": "Hello.",
                        "mixGroupId": "joint-1",
                    },
                    {
                        "id": "segment-3",
                        "text": "——",
                        "sourceSpanIds": ["span-2"],
                        "effectiveCharacterId": "narrator",
                        "referenceAudio": "voices/alice/voice-1.wav",
                        "referenceText": "Hello.",
                        "mixGroupId": None,
                    },
                ],
            }
        ],
    }

    result = render_plan_audio(tmp_path, package, "book-1", plan, "english", lambda *_: None)

    pointer = json.loads((package / "audio/chapter-1/latest.json").read_text())
    metadata = json.loads(
        (package / "audio/chapter-1" / pointer["revision"] / "metadata.json").read_text()
    )
    assert result[0]["revision"] == pointer["revision"]
    assert metadata["segments"][0]["sourceSpanIds"] == ["span-1"]
    assert len(metadata["segments"]) == 2
    assert [row["effectiveCharacterId"] for row in metadata["segments"][0]["mixedSegments"]] == [
        "alice",
        "bob",
    ]
    assert metadata["segments"][1]["skipped"] == "no-speakable-text"
    assert metadata["segments"][1]["file"] is None
    assert not list((package / "audio/chapter-1").glob("*.staging"))
    assert not stale_staging.exists()


def test_chapter_assembly_is_byte_exact_without_holding_audio_arrays(tmp_path):
    sample_rate = 100
    first = np.array([0.125, -0.5], dtype=np.float32)
    second = np.array([0.25, 0.75, -0.125], dtype=np.float32)
    first_path = tmp_path / "first.wav"
    second_path = tmp_path / "second.wav"
    output = tmp_path / "streamed.wav"
    expected = tmp_path / "expected.wav"
    wavfile.write(first_path, sample_rate, first)
    wavfile.write(second_path, sample_rate, second)

    sample_count = _assemble_chapter_wav(
        output,
        [first_path, second_path],
        sample_rate,
        gap_seconds=0.02,
    )
    expected_samples = np.concatenate([first, np.zeros(2, dtype=np.float32), second])
    wavfile.write(expected, sample_rate, expected_samples)

    assert sample_count == len(expected_samples)
    assert output.read_bytes() == expected.read_bytes()
    actual_rate, actual_samples = wavfile.read(output)
    assert actual_rate == sample_rate
    assert np.array_equal(actual_samples, expected_samples)


def test_chapter_assembly_rejects_incompatible_segment_audio(tmp_path):
    segment = tmp_path / "wrong-rate.wav"
    wavfile.write(segment, 200, np.ones(4, dtype=np.float32))

    with pytest.raises(TTSContractError, match="unexpected sample rate"):
        _assemble_chapter_wav(tmp_path / "chapter.wav", [segment], 100)


def test_large_chapter_header_uses_rf64_without_allocating_chapter_audio():
    sample_count = 0x1_0000_0000 // np.dtype(np.float32).itemsize

    header = _float32_mono_wav_header(24_000, sample_count)

    assert header.startswith(b"RF64\xff\xff\xff\xffWAVEds64")
    assert header.endswith(b"data\xff\xff\xff\xff")


def test_generated_audio_history_stays_playable_and_reports_stale_inputs(tmp_path):
    package = tmp_path / "package"
    directory = package / "audio" / "chapter-1" / "audio-1"
    directory.mkdir(parents=True)
    (directory / "chapter.wav").write_bytes(b"RIFF")
    (directory / "metadata.json").write_text(
        json.dumps(
            {
                "bookId": "book-1",
                "revision": "audio-1",
                "audioSeconds": 1.0,
                "segments": [
                    {
                        "id": "segment-1",
                        "text": "Hello.",
                        "sourceSpanIds": ["span-1"],
                        "effectiveSpeaker": "Narrator",
                    }
                ],
                "inputRevisions": {"dialogue": "d1", "cast": "c1", "script": "s1"},
            }
        )
    )
    (directory.parent / "latest.json").write_text(
        json.dumps({"revision": "audio-1", "path": str(directory)})
    )

    rows = _generated_chapters(
        package,
        {"dialogue": "d1", "cast": "c1", "script": "s2"},
    )

    assert rows[0]["current"] is False
    assert rows[0]["staleReasons"] == ["script:s1->s2"]
    assert rows[0]["audioUrl"].endswith("/chapters/chapter-1/audio-1/audio")
    assert rows[0]["segmentCount"] == 1
    assert rows[0]["segments"][0]["sourceSpanIds"] == ["span-1"]
    assert rows[0]["revisions"][0]["revision"] == "audio-1"


def test_semantically_identical_reaccepted_inputs_keep_generated_audio_current(tmp_path):
    package = tmp_path / "package"
    voice = {
        "characterId": "narrator",
        "name": "Narrator",
        "category": "narrator",
        "voiceAccepted": True,
        "acceptedVoiceRevision": "voice-1",
        "referenceAudio": "voices/narrator/voice-1.wav",
        "referenceText": "Reference line.",
    }
    group = {
        **voice,
        "characterId": "group-1",
        "name": "Crowd",
        "category": "group",
    }
    old_cast = {
        "revision": "cast-1",
        "voiceModel": "voice-model",
        "language": "english",
        "labelToCharacterId": {"Crowd": "group-1"},
        "narrator": voice,
        "identities": [group],
    }
    new_cast = {
        **old_cast,
        "revision": "cast-2",
        "reusedFromRevision": "cast-1",
        "identities": [{**group, "voiceRoute": {"kind": "dedicated"}}],
    }
    old_script = {
        "revision": "script-1",
        "status": "ready",
        "entries": [{"id": "entry-1", "kind": "source", "text": "Hello."}],
        "sourceCoverage": {"status": "exact", "sourceSpanIds": ["span-1"]},
        "inputRevisions": {"cast": "cast-1"},
    }
    new_script = {
        **old_script,
        "revision": "script-2",
        "inputRevisions": {"cast": "cast-2"},
    }
    for kind, artifact in (
        ("cast", old_cast),
        ("cast", new_cast),
        ("script", old_script),
        ("script", new_script),
    ):
        write_artifact(package, kind, artifact, publish=False)

    directory = package / "audio" / "chapter-1" / "audio-1"
    directory.mkdir(parents=True)
    (directory / "chapter.wav").write_bytes(b"RIFF")
    (directory / "metadata.json").write_text(
        json.dumps(
            {
                "bookId": "book-1",
                "revision": "audio-1",
                "audioSeconds": 1.0,
                "segments": [],
                "inputRevisions": {
                    "dialogue": "dialogue-1",
                    "review": "review-1",
                    "cast": "cast-1",
                    "script": "script-1",
                },
            }
        )
    )
    (directory.parent / "latest.json").write_text(
        json.dumps({"revision": "audio-1", "path": str(directory)})
    )

    rows = _generated_chapters(
        package,
        {
            "dialogue": "dialogue-1",
            "review": "review-1",
            "cast": "cast-2",
            "script": "script-2",
        },
    )

    assert rows[0]["current"] is True
    assert rows[0]["staleReasons"] == []

    changed_cast = {
        **new_cast,
        "revision": "cast-3",
        "narrator": {**voice, "acceptedVoiceRevision": "voice-2"},
    }
    write_artifact(package, "cast", changed_cast, publish=False)
    changed_voice = _generated_chapters(package, {"cast": "cast-3"})
    assert changed_voice[0]["current"] is False
    assert changed_voice[0]["staleReasons"] == ["cast:cast-1->cast-3"]

    changed_script = {
        **new_script,
        "revision": "script-3",
        "entries": [{"id": "entry-1", "kind": "source", "text": "Changed."}],
    }
    write_artifact(package, "script", changed_script, publish=False)
    changed_text = _generated_chapters(package, {"script": "script-3"})
    assert changed_text[0]["current"] is False
    assert changed_text[0]["staleReasons"] == ["script:script-1->script-3"]


def test_every_audition_uses_the_same_neutral_phrase_contract():
    narrator = _audition_line("Narrator", "english")
    alice = _audition_line("Alice", "english")
    assert narrator.removeprefix("This is the voice of Narrator. ") == alice.removeprefix(
        "This is the voice of Alice. "
    )
    assert len(narrator.split()) >= 35
    assert _audition_line("林", "chinese").startswith("这是林的声音。明亮的清晨")
    assert _audition_line("Mara", "portuguese").startswith(
        "Esta é a voz de Mara. Na manhã luminosa"
    )


def test_review_only_change_reuses_the_accepted_cast_and_auditions(tmp_path):
    package = tmp_path / "package"
    _, accepted = write_artifact(
        package,
        "cast",
        {
            "revision": "cast-accepted-1",
            "phase": "accepted",
            "status": "accepted",
            "dialogueRevision": "dialogue-1",
            "reviewRevision": "review-1",
            "dossiers": [],
            "proposals": [],
            "narrator": {
                "characterId": "narrator",
                "name": "Narrator",
                "voiceAccepted": True,
                "acceptedVoiceRevision": "voice-1",
                "voicePreviewRevision": "voice-1",
                "voiceCandidates": [{"revision": "voice-1", "previewUrl": "/voice.wav"}],
            },
            "identities": [],
        },
        publish=False,
    )

    rebased = _rebase_accepted_cast(
        package,
        dialogue_revision="dialogue-1",
        review_revision="review-2",
        revision="cast-candidate-2",
        voice_recipe_version_for_model=lambda _model_id: "1",
        default_voice_model="qwen",
    )

    assert rebased is not None
    assert rebased["phase"] == "audition-review"
    assert rebased["reviewRevision"] == "review-2"
    assert rebased["reusedFromRevision"] == accepted["revision"]
    assert rebased["narrator"] == accepted["narrator"]
    assert rebased["auditionPackRefreshRequired"] is True
    assert (
        _rebase_accepted_cast(
            package,
            dialogue_revision="dialogue-2",
            review_revision="review-2",
            revision="cast-candidate-3",
            voice_recipe_version_for_model=lambda _model_id: "1",
            default_voice_model="qwen",
        )
        is None
    )


def test_review_only_change_reuses_a_current_whole_audition_pack(tmp_path):
    package = tmp_path / "package"
    write_artifact(
        package,
        "cast",
        {
            "revision": "cast-accepted-1",
            "phase": "accepted",
            "status": "accepted",
            "dialogueRevision": "dialogue-1",
            "reviewRevision": "review-1",
            "voiceModel": "balanced",
            "auditionPackRecipeVersion": "7",
            "narrator": {"characterId": "narrator", "voiceCandidates": []},
            "identities": [],
        },
        publish=False,
    )

    rebased = _rebase_accepted_cast(
        package,
        dialogue_revision="dialogue-1",
        review_revision="review-2",
        revision="cast-candidate-2",
        voice_recipe_version_for_model=lambda model_id: (
            "7" if model_id == "balanced" else "unexpected"
        ),
        default_voice_model="fallback",
    )

    assert rebased is not None
    assert rebased["auditionPackRefreshRequired"] is False


def test_audio_recipe_or_model_refresh_reuses_language_bound_profiles(tmp_path):
    recipe = {"version": "1"}
    profile_calls = 0
    profile_languages: list[str] = []
    audition_batches: list[list[str]] = []
    audition_lines: list[dict[str, str]] = []
    narrator_audition_line = (
        "Night settled quietly over the harbour while the last lanterns flickered along "
        "the quay. Beyond the breakwater, a patient bell marked the hour, and every "
        "darkened window seemed to guard a secret."
    )
    alice_audition_line = (
        "I kept the silver key, although nobody thought to ask me why. Tomorrow I will "
        "cross the square, unlock the weathered garden door, and discover which promise "
        "has been waiting there."
    )
    french_narrator_audition_line = (
        "La nuit descendait doucement sur le port tandis que les dernières lanternes "
        "vacillaient le long du quai. Au-delà de la digue, une cloche patiente marquait "
        "l'heure et chaque fenêtre sombre semblait garder un secret."
    )
    french_alice_audition_line = (
        "J'ai gardé la clé d'argent, même si personne ne songeait à me demander pourquoi. "
        "Demain, je traverserai la place, ouvrirai la vieille porte du jardin et découvrirai "
        "quelle promesse m'y attend."
    )

    proposal = {
        "status": "ready",
        "dossiers": [{"label": "Alice", "occurrenceCount": 1, "examples": []}],
        "fuzzyCandidates": [],
        "globalLabelLedger": "Alice\t1\tfirst:0",
        "proposals": [
            {
                "label": "Alice",
                "category": "character",
                "canonicalName": "Alice",
                "aliases": [],
                "competingLabels": [],
                "reason": "Explicit source label.",
                "reviewRequired": False,
            }
        ],
        "reconciliationConflicts": [],
        "processing": {"labels": 1, "batches": 1, "model": "test"},
    }

    def profile(_repo, identities, *_args, **_kwargs):
        nonlocal profile_calls
        profile_calls += 1
        language = str(_kwargs.get("language") or "")
        profile_languages.append(language)
        settings = {
            "presentation": "unspecified",
            "age": "adult",
            "tone": "warm",
            "pitch": "medium",
            "pace": "measured",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Stable reviewed direction.",
        }
        narrator_line = (
            french_narrator_audition_line
            if language == "french"
            else narrator_audition_line
        )
        alice_line = (
            french_alice_audition_line
            if language == "french"
            else alice_audition_line
        )
        return {
            "narrator": {**settings, "auditionLine": narrator_line},
            **{
                str(row["characterId"]): {
                    **settings,
                    "auditionLine": alice_line,
                }
                for row in identities
            },
        }

    def audition(_repo, _package, _book_id, characters, report, _language, _model):
        audition_batches.append([str(row["id"]) for row in characters])
        audition_lines.append(
            {str(row["id"]): str(row["previewLine"]) for row in characters}
        )
        for row in characters:
            revision = f"{recipe['version']}-{row['id']}-{len(audition_batches)}"
            row.update(
                {
                    "voicePreviewRevision": revision,
                    "previewUrl": f"/voice/{revision}",
                    "referenceText": row["previewLine"],
                    "voice": row["voiceDirection"],
                    "voiceCandidates": [
                        {
                            "revision": revision,
                            "previewUrl": f"/voice/{revision}",
                            "referenceText": row["previewLine"],
                            "direction": row["voiceDirection"],
                            "voiceSettings": row["voiceSettings"],
                        }
                    ],
                }
            )
        report(100, "done")
        return characters

    with TestClient(
        create_app_v2(
            tmp_path,
            cast_proposer=lambda *_args: proposal,
            voice_profiler=profile,
            voice_auditioner=audition,
            voice_models=lambda _root: [
                {
                    "id": "balanced",
                    "label": "Balanced",
                    "recipeVersion": recipe["version"],
                    "supportedLanguages": ["english", "french"],
                },
                {
                    "id": "studio",
                    "label": "Studio",
                    "recipeVersion": "5",
                    "supportedLanguages": ["english", "french"],
                },
            ],
            voice_languages=lambda _root, _model: ["english", "french"],
            default_voice_model="balanced",
            voice_candidate_policy={
                "enabled": False,
                "coverage_fraction": 0.8,
                "min_voices": 0,
                "max_voices": 1,
                "extra_candidates": 1,
            },
            generate_voice_audition_lines=True,
        )
    ) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        _seed_reviewed_transcript(tmp_path, book_id)

        identity = _process(client, book_id, "cast", {})
        first = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": identity["revision"],
                "voiceModel": "balanced",
                "language": "english",
            },
        )
        first_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{first['revision']}"
        ).json()
        first_voices = [first_candidate["narrator"], *first_candidate["identities"]]
        decisions = [
            {"characterId": row["characterId"], "voiceRevision": row["voicePreviewRevision"]}
            for row in first_voices
        ]
        assert _accept(client, book_id, "cast", first["revision"], decisions).status_code == 200

        recipe["version"] = "2"
        reopened = _process(client, book_id, "cast", {})
        reopened_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{reopened['revision']}"
        ).json()
        assert reopened_candidate["auditionPackRefreshRequired"] is True
        assert _accept(client, book_id, "cast", reopened["revision"], decisions).status_code == 409

        refreshed = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": reopened["revision"],
                "voiceModel": "balanced",
                "language": "english",
            },
        )
        refreshed_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{refreshed['revision']}"
        ).json()
        switched = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": refreshed["revision"],
                "voiceModel": "studio",
                "language": "english",
            },
        )
        switched_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{switched['revision']}"
        ).json()
        translated = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": switched["revision"],
                "voiceModel": "studio",
                "language": "french",
            },
        )
        translated_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{translated['revision']}"
        ).json()

    refreshed_voices = [refreshed_candidate["narrator"], *refreshed_candidate["identities"]]
    switched_voices = [switched_candidate["narrator"], *switched_candidate["identities"]]
    translated_voices = [
        translated_candidate["narrator"],
        *translated_candidate["identities"],
    ]
    assert refreshed_candidate["auditionPackRecipeVersion"] == "2"
    assert refreshed_candidate["auditionPackRefreshRequired"] is False
    assert switched_candidate["voiceModel"] == "studio"
    assert translated_candidate["language"] == "french"
    assert profile_calls == 2
    assert profile_languages == ["english", "french"]
    assert audition_batches == [
        ["narrator", first_candidate["identities"][0]["characterId"]],
        ["narrator", first_candidate["identities"][0]["characterId"]],
        ["narrator", first_candidate["identities"][0]["characterId"]],
        ["narrator", first_candidate["identities"][0]["characterId"]],
    ]
    assert [row["characterId"] for row in refreshed_voices] == [
        row["characterId"] for row in first_voices
    ]
    assert [row["voiceSettings"] for row in refreshed_voices] == [
        row["voiceSettings"] for row in first_voices
    ]
    assert [row["auditionLine"] for row in refreshed_voices] == [
        row["auditionLine"] for row in first_voices
    ]
    assert [row["auditionLine"] for row in switched_voices] == [
        row["auditionLine"] for row in first_voices
    ]
    assert audition_lines[0] == audition_lines[1] == audition_lines[2] == {
        "narrator": narrator_audition_line,
        first_candidate["identities"][0]["characterId"]: alice_audition_line,
    }
    assert audition_lines[3] == {
        "narrator": french_narrator_audition_line,
        first_candidate["identities"][0]["characterId"]: french_alice_audition_line,
    }
    assert [row["auditionLine"] for row in translated_voices] == [
        french_narrator_audition_line,
        french_alice_audition_line,
    ]
    assert all(str(row["voicePreviewRevision"]).startswith("2-") for row in refreshed_voices)
    assert not {row["voicePreviewRevision"] for row in first_voices} & {
        candidate["revision"] for row in refreshed_voices for candidate in row["voiceCandidates"]
    }


def test_legacy_cast_line_counts_are_backfilled_without_rewriting_audio():
    cast = {
        "phase": "audition-review",
        "dossiers": [{"label": "Alice", "occurrenceCount": 3}],
        "identityReviewDecisions": [],
        "narrator": {"characterId": "narrator", "name": "Narrator"},
        "identities": [{"characterId": "alice", "name": "Alice", "literalLabels": ["Alice"]}],
    }
    enriched = _cast_with_line_counts(
        cast,
        {"spans": [{"renderRole": "narration", "text": "A quiet morning."}]},
    )

    assert enriched["narrator"]["lineCount"] == 1
    assert enriched["identities"][0]["lineCount"] == 3
    assert "lineCount" not in cast["narrator"]


def test_cast_acceptance_pins_a_layered_group_to_existing_character_voices():
    def voice(character_id: str, name: str, category: str = "character") -> dict:
        revision = f"voice-{character_id}"
        return {
            "characterId": character_id,
            "name": name,
            "category": category,
            "voicePreviewRevision": revision,
            "voiceCandidates": [
                {
                    "revision": revision,
                    "previewUrl": f"/{revision}.wav",
                    "referenceText": f"Reference for {name}.",
                    "direction": "Natural.",
                }
            ],
        }

    candidate = {
        "revision": "candidate-1",
        "phase": "audition-review",
        "narrator": voice("narrator", "Narrator", "narrator"),
        "identities": [
            voice("alice", "Alice"),
            voice("rabbit", "Rabbit"),
            voice("alice-rabbit", "Alice & Rabbit", "group"),
        ],
    }

    accepted = _accept_voice_revisions(
        candidate,
        [
            {"characterId": "narrator", "voiceRevision": "voice-narrator"},
            {"characterId": "alice", "voiceRevision": "voice-alice"},
            {"characterId": "rabbit", "voiceRevision": "voice-rabbit"},
            {
                "characterId": "alice-rabbit",
                "voiceRoute": {
                    "kind": "layered",
                    "characterIds": ["alice", "rabbit"],
                },
            },
        ],
        "cast-accepted",
    )

    group = accepted["identities"][-1]
    assert group["voiceAccepted"] is True
    assert group["voiceRoute"] == {
        "kind": "layered",
        "characterIds": ["alice", "rabbit"],
    }
    assert "acceptedVoiceRevision" not in group
    assert all(row["voiceAccepted"] for row in accepted["identities"])


def test_layered_voice_preview_mixes_exact_audition_revisions(tmp_path):
    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        package = tmp_path / "packages" / book_id
        for character_id, revision, audio in (
            ("alice", "a1", np.array([0.2, 0.2, 0.2], dtype=np.float32)),
            ("rabbit", "r1", np.array([0.6, 0.6], dtype=np.float32)),
        ):
            path = package / "voices" / character_id / f"{revision}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            wavfile.write(path, 1_000, audio)

        response = client.get(
            f"/api/books/{book_id}/voices/layered/audio",
            params=[("member", "alice:a1"), ("member", "rabbit:r1")],
        )

        assert response.status_code == 200
        sample_rate, mixed = wavfile.read(BytesIO(response.content))
        assert sample_rate == 1_000
        np.testing.assert_allclose(mixed, np.array([0.4, 0.4, 0.1], dtype=np.float32))


def test_cross_book_reuse_preview_is_read_only_and_import_skips_all_generation(tmp_path):
    from meowdiobooks.backend.cast_service import default_voice_settings
    calls = []
    recipe = ["1"]

    class Reuse:
        def preview(self, book_id, package, targets, source_ids, language, model_id):
            calls.append(('preview', source_ids))
            return {'sources': [{'bookId': 'source', 'title': 'Earlier book', 'voiceCount': 2}],
                    'exactMatchCount': len(targets), 'remainingVoiceCount': 0,
                    'totalVoiceCount': len(targets)}

        def apply(self, book_id, package, targets, source_ids, language, model_id, *, preview_fingerprint=None):
            assert preview_fingerprint == "bound-source-revisions"
            calls.append(('apply', source_ids))
            imported = {}
            for target in targets:
                cid = target['characterId']
                revision = f'imported-{cid}'
                relative = f'voices/{cid}/{revision}.wav'
                path = package / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'RIFF-test')
                imported[cid] = {**target, 'voicePreviewRevision': revision,
                    'previewUrl': f'/voice/{revision}', 'referenceAudio': relative,
                    'referenceText': 'A durable independent voice sample.',
                    'voiceSettings': default_voice_settings(target['category']),
                    'voiceDirection': 'Clear and natural.',
                    'voiceCandidates': [{'revision': revision, 'previewUrl': f'/voice/{revision}',
                                         'referenceAudio': relative, 'referenceText': 'Sample.'}],
                    'reuseProvenance': {'bookId': 'source'}}
            self.imported = imported
            return imported

        def import_voice(self, book_id, package, target, source_voice, language, model_id):
            assert source_voice == {'bookId': 'source', 'characterId': 'different-name', 'revision': 'selected'}
            row = dict(self.imported[target['characterId']])
            row['voiceSettings'] = {**row['voiceSettings'], 'tone': 'bright'}
            return row

    proposal = {'status': 'ready', 'dossiers': [], 'proposals': [
        {'label': 'Alice', 'category': 'character', 'canonicalName': 'Alice', 'aliases': [],
         'competingLabels': [], 'reviewRequired': False, 'reason': 'Explicit label.'}]}
    def forbidden(*args, **kwargs):
        pytest.fail('Imported voices must not be profiled or generated')
    with TestClient(create_app_v2(tmp_path, cast_proposer=lambda *_: proposal,
                                 voice_profiler=forbidden, voice_auditioner=forbidden,
                                 cast_voice_reuse=Reuse(),
                                 default_voice_model="snapshot-test",
                                 voice_models=lambda *_: [
                                     {"id": model, "recipeVersion": recipe[0]}
                                     for model in ("snapshot-test", "snapshot-new")],
                                 voice_languages=lambda *_: ["english"])) as client:
        book_id = client.post('/api/books/import', files={'file': ('book.pdf', _pdf(), 'application/pdf')}).json()['book']['id']
        _seed_reviewed_transcript(tmp_path, book_id)
        identity = _process(client, book_id, 'cast', {})
        settings = {'proposalRevision': identity['revision'], 'language': 'english', 'sourceBookIds': ['source'], 'castingPreviewFingerprint': 'bound-source-revisions'}
        preview = client.post(f'/api/books/{book_id}/cast/reuse-preview', json=settings)
        assert preview.status_code == 200, preview.text
        assert preview.json()['exactMatchCount'] == 2
        assert calls == [('preview', ['source'])]
        result = _process(client, book_id, 'cast', settings)
        candidate = client.get(f"/api/books/{book_id}/stages/cast/candidates/{result['revision']}").json()
        assert candidate['sourceBookIds'] == ['source']
        assert candidate['narrator']['voicePreviewRevision'] == 'imported-narrator'
        assert candidate['identities'][0]['reuseProvenance'] == {'bookId': 'source'}
        assert candidate['identities'][0]['voiceAccepted'] is False
        assert calls == [('preview', ['source']), ('apply', ['source'])]
        # Reopening the same selection uses only destination snapshots, even if the
        # source subsequently disappears. The provider is not called again.
        reopened = _process(client, book_id, 'cast', {**settings, 'proposalRevision': result['revision']})
        recast = client.get(f"/api/books/{book_id}/stages/cast/candidates/{reopened['revision']}").json()
        assert calls == [('preview', ['source']), ('apply', ['source'])]
        manual = _process(client, book_id, 'cast', {
            'proposalRevision': reopened['revision'], 'characterId': recast['identities'][0]['characterId'],
            'sourceVoice': {'bookId': 'source', 'characterId': 'different-name', 'revision': 'selected'},
        })
        corrected = client.get(f"/api/books/{book_id}/stages/cast/candidates/{manual['revision']}").json()
        assert corrected['identities'][0]['voiceSettings']['tone'] == 'bright'
        rows = [recast['narrator'], *recast['identities']]
        decisions = [{'characterId': row['characterId'], 'voiceRevision': row['voicePreviewRevision']} for row in rows]
        response = _accept(client, book_id, 'cast', reopened['revision'], decisions)
        assert response.status_code == 200, response.text
        accepted = read_artifact(tmp_path / 'packages' / book_id, 'cast')
        assert accepted['narrator']['reuseProvenance'] == {'bookId': 'source'}
        assert accepted['identities'][0]['acceptedVoiceRevision'].startswith('imported-')

        # Imported identities retain their own recipe and survive new casting defaults,
        # even after source selection is cleared because the source book was deleted.
        recipe[0] = "2"
        upgraded = _process(client, book_id, 'cast', {
            'proposalRevision': reopened['revision'], 'sourceBookIds': [],
            'language': 'english', 'voiceModel': 'snapshot-new',
        })
        after = client.get(f"/api/books/{book_id}/stages/cast/candidates/{upgraded['revision']}").json()
        assert after['auditionPackRecipeVersion'] == '2'
        assert after['narrator']['voicePreviewRevision'] == recast['narrator']['voicePreviewRevision']
        assert after['identities'][0]['voicePreviewRevision'] == recast['identities'][0]['voicePreviewRevision']
        assert after['narrator']['reusedVoiceSnapshot'] is True
        assert after['identities'][0]['reusedVoiceSnapshot'] is True
        assert calls == [('preview', ['source']), ('apply', ['source'])]
