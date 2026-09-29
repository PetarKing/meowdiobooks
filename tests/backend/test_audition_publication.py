"""Public HTTP regressions for irreversible audition publication boundaries."""

from copy import deepcopy
from io import BytesIO
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.io import wavfile

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import artifact_history, read_artifact, write_artifact
from tests.backend.test_app_v2_finish import _pdf, _seed_reviewed_transcript


def _wav():
    output = BytesIO()
    wavfile.write(output, 24_000, np.zeros(2_400, dtype=np.float32))
    return output.getvalue()


def _seed(client, root):
    book = client.post(
        "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
    ).json()["book"]["id"]
    package, dialogue, review = _seed_reviewed_transcript(root, book)
    voices = []
    for cid in ("narrator", "alice"):
        candidates = []
        for number in (1, 2, 3):
            revision = f"{cid}-{number}"
            relative = f"voices/{cid}/{revision}.wav"
            path = package / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(_wav())
            candidates.append(
                {
                    "revision": revision,
                    "referenceAudio": relative,
                    "previewUrl": f"/api/books/{book}/voices/{cid}/{revision}/audio",
                    "referenceText": "Exact original words.",
                    "direction": "Original.",
                }
            )
        voices.append(
            {
                "characterId": cid,
                "name": cid.title(),
                "category": "narrator" if cid == "narrator" else "character",
                "literalLabels": [] if cid == "narrator" else ["Alice"],
                "voiceCandidates": candidates,
                "voicePreviewRevision": f"{cid}-1",
                "previewUrl": candidates[0]["previewUrl"],
                "referenceAudio": candidates[0]["referenceAudio"],
                "referenceText": candidates[0]["referenceText"],
                "voiceAccepted": True,
                "acceptedVoiceRevision": f"{cid}-1",
            }
        )
    accepted_path, accepted = write_artifact(
        package,
        "cast",
        {
            "revision": "accepted-before",
            "phase": "accepted",
            "status": "accepted",
            "dialogueRevision": dialogue["revision"],
            "reviewRevision": review["revision"],
            "language": "english",
            "voiceModel": "test",
            "auditionPackRecipeVersion": "1",
            "labelToCharacterId": {"Alice": "alice"},
            "narrator": voices[0],
            "identities": [voices[1]],
        },
    )
    write_artifact(
        package,
        "cast",
        {**accepted, "revision": "editable", "phase": "audition-review"},
        publish=False,
    )
    return book, package, accepted_path.read_bytes()


def _new_voice(package, book, row):
    path = package / "voices/alice/alice-4.wav"
    path.write_bytes(_wav())
    candidate = {
        "revision": "alice-4",
        "previewUrl": f"/api/books/{book}/voices/alice/alice-4/audio",
        "referenceAudio": "voices/alice/alice-4.wav",
        "referenceText": "New exact words.",
        "direction": "New sound.",
    }
    return {
        **deepcopy(row),
        "voicePreviewRevision": "alice-4",
        "previewUrl": candidate["previewUrl"],
        "referenceAudio": candidate["referenceAudio"],
        "referenceText": candidate["referenceText"],
        "voiceCandidates": [candidate],
    }


def _app(root, **providers):
    return create_app_v2(
        root,
        default_voice_model="test",
        voice_models=lambda *_: [{"id": "test", "recipeVersion": "1"}],
        voice_languages=lambda *_: ["english"],
        **providers,
    )


def _submit(client, book, **settings):
    response = client.post(
        f"/api/books/{book}/stages/cast/process",
        json={
            "settings": {
                "proposalRevision": "editable",
                "characterId": "alice",
                **settings,
            }
        },
    )
    assert response.status_code == 202, response.text
    return response.json()["id"]


def _terminal(client, job):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = client.get(f"/api/jobs/{job}").json()
        if result["status"] in {"succeeded", "failed", "canceled"}:
            return result
        time.sleep(0.01)
    raise AssertionError("Audition did not finish")


def _unchanged(client, book, package, accepted_bytes):
    assert len(artifact_history(package, "cast")) == 2
    snapshot = client.get(f"/api/books/{book}/snapshot").json()
    assert snapshot["pendingCandidates"]["cast"]["revision"] == "editable"
    assert read_artifact(package, "cast")["revision"] == "accepted-before"
    assert (package / "artifacts/cast/accepted-before.json").read_bytes() == accepted_bytes
    assert client.get(f"/api/books/{book}/voices/alice/alice-4/audio").status_code == 404
    for number in (1, 2, 3):
        response = client.get(f"/api/books/{book}/voices/alice/alice-{number}/audio")
        assert response.status_code == 200
        assert response.content == _wav()


@pytest.mark.parametrize(
    "case",
    [
        "raises",
        "missing",
        "empty_audio",
        "empty_result",
        "wrong_identity",
        "repeat_revision",
        "bad_reference",
    ],
)
def test_invalid_or_failed_adapter_does_not_publish_and_cleans_new_audio(tmp_path, case):
    def provider(_repo, package, book, rows, *_):
        generated = _new_voice(package, book, rows[0])
        if case == "raises":
            raise RuntimeError("Failed after rendering audio")
        if case == "missing":
            (package / "voices/alice/alice-4.wav").unlink()
        if case == "empty_audio":
            (package / "voices/alice/alice-4.wav").write_bytes(b"")
        if case == "empty_result":
            return []
        if case == "wrong_identity":
            generated["id"] = "another-identity"
        if case == "repeat_revision":
            generated["voicePreviewRevision"] = "alice-1"
            generated["voiceCandidates"][0]["revision"] = "alice-1"
        if case == "bad_reference":
            generated["voiceCandidates"][0]["referenceAudio"] = "voices/alice/alice-1.wav"
        return [generated]

    with TestClient(_app(tmp_path, voice_auditioner=provider)) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        result = _terminal(client, _submit(client, book))
        assert result["status"] == "failed", result
        _unchanged(client, book, package, accepted_bytes)


@pytest.mark.parametrize("source", ["generated", "imported"])
def test_running_cancel_prevents_generated_and_imported_candidate_publication(tmp_path, source):
    started, release = threading.Event(), threading.Event()

    def provider(_repo, package, book, rows, *_):
        started.set()
        assert release.wait(3)
        return [_new_voice(package, book, rows[0])]

    class Reuse:
        def import_voice(self, book, package, target, *_):
            started.set()
            assert release.wait(3)
            return _new_voice(package, book, target)

    with TestClient(_app(tmp_path, voice_auditioner=provider, cast_voice_reuse=Reuse())) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        settings = (
            {"sourceVoice": {"bookId": "source", "characterId": "alice", "revision": "source"}}
            if source == "imported"
            else {}
        )
        job = _submit(client, book, **settings)
        try:
            assert started.wait(3)
            assert client.post(f"/api/jobs/{job}/cancel").status_code == 200
        finally:
            release.set()
        result = _terminal(client, job)
        assert result["status"] == "canceled", result
        _unchanged(client, book, package, accepted_bytes)


@pytest.mark.parametrize("operation", ["generated", "imported", "upload", "delete"])
def test_stale_editable_base_cannot_erase_a_new_audition_or_call_provider(
    tmp_path, monkeypatch, operation
):
    calls = []

    def provider(_repo, package, book, rows, *_):
        calls.append("generated")
        return [_new_voice(package, book, rows[0])]

    class Reuse:
        def import_voice(self, *_):
            calls.append("imported")
            raise AssertionError("Stale draft must be rejected before importing a voice")

    def forbidden(*_):
        raise AssertionError("Stale draft must be rejected before normalizing or cloning audio")

    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", forbidden)
    with TestClient(
        _app(
            tmp_path,
            voice_auditioner=provider,
            cast_voice_reuse=Reuse(),
            voice_sample_auditioner=forbidden,
        )
    ) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        first = _terminal(client, _submit(client, book))
        assert first["status"] == "succeeded", first
        if operation in {"generated", "imported"}:
            settings = (
                {"sourceVoice": {"bookId": "source", "characterId": "alice", "revision": "source"}}
                if operation == "imported"
                else {}
            )
            failed = _terminal(client, _submit(client, book, **settings))
            assert failed["status"] == "failed", failed
            assert "draft changed" in failed["error"]
        elif operation == "upload":
            assert (
                client.post(
                    f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload",
                    data={"reference_text": "Exact sample words."},
                    files={"file": ("sample.wav", _wav(), "audio/wav")},
                ).status_code
                == 409
            )
        else:
            assert (
                client.delete(
                    f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/alice-1"
                ).status_code
                == 409
            )
        assert calls == ["generated"]
        assert client.get(f"/api/books/{book}/voices/alice/alice-4/audio").status_code == 200
        snapshot = client.get(f"/api/books/{book}/snapshot").json()
        assert snapshot["pendingCandidates"]["cast"]["revision"] == first["result"]["revision"]
        assert (package / "artifacts/cast/accepted-before.json").read_bytes() == accepted_bytes


def test_clone_rejects_changed_upstream_before_normalization_and_provider(tmp_path, monkeypatch):
    def forbidden(*_):
        raise AssertionError("Stale upstream must be rejected before paid or decoding work")

    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", forbidden)
    with TestClient(_app(tmp_path, voice_sample_auditioner=forbidden)) as client:
        book, package, _ = _seed(client, tmp_path)
        review = read_artifact(package, "review")
        write_artifact(package, "review", {**review, "revision": "changed-review"})
        response = client.post(
            f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload",
            data={"reference_text": "Exact words."},
            files={"file": ("sample.wav", _wav(), "audio/wav")},
        )
        assert response.status_code == 409
        assert "reviewed book changed" in response.json()["detail"]
        assert len(artifact_history(package, "cast")) == 2


def test_acceptance_rejects_missing_selected_audio_without_moving_accepted_pointer(tmp_path):
    def provider(_repo, package, book, rows, *_):
        return [_new_voice(package, book, rows[0])]

    with TestClient(_app(tmp_path, voice_auditioner=provider)) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        generated = _terminal(client, _submit(client, book))
        assert generated["status"] == "succeeded"
        (package / "voices/alice/alice-4.wav").unlink()
        response = client.post(
            f"/api/books/{book}/stages/cast/accept",
            json={
                "revision": generated["result"]["revision"],
                "decisions": [
                    {"characterId": "narrator", "voiceRevision": "narrator-1"},
                    {"characterId": "alice", "voiceRevision": "alice-4"},
                ],
            },
        )
        assert response.status_code == 409
        assert "audio is missing" in response.json()["detail"]
        assert read_artifact(package, "cast")["revision"] == "accepted-before"
        assert (package / "artifacts/cast/accepted-before.json").read_bytes() == accepted_bytes


def test_simultaneous_http_requests_from_one_base_only_admit_the_first(tmp_path):
    started, release = threading.Event(), threading.Event()
    calls = []

    def provider(_repo, package, book, rows, *_):
        calls.append("provider")
        started.set()
        assert release.wait(3)
        return [_new_voice(package, book, rows[0])]

    with TestClient(_app(tmp_path, voice_auditioner=provider)) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        first_job = _submit(client, book)
        try:
            assert started.wait(3)
            second = client.post(
                f"/api/books/{book}/stages/cast/process",
                json={
                    "settings": {
                        "proposalRevision": "editable",
                        "characterId": "alice",
                    }
                },
            )
            assert second.status_code == 409
            assert second.json()["detail"]["jobId"] == first_job
        finally:
            release.set()
        first = _terminal(client, first_job)
        assert first["status"] == "succeeded", first
        assert calls == ["provider"]
        snapshot = client.get(f"/api/books/{book}/snapshot").json()
        assert snapshot["pendingCandidates"]["cast"]["revision"] == first["result"]["revision"]
        assert client.get(f"/api/books/{book}/voices/alice/alice-4/audio").status_code == 200
        assert (package / "artifacts/cast/accepted-before.json").read_bytes() == accepted_bytes


def test_provider_returning_after_an_upload_cannot_overwrite_or_prune_uploaded_audition(
    tmp_path, monkeypatch
):
    started, release = threading.Event(), threading.Event()

    def provider(_repo, package, book, rows, *_):
        started.set()
        assert release.wait(3)
        return [_new_voice(package, book, rows[0])]

    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.normalize_voice_sample", lambda *_: (_wav(), 4.0)
    )
    with TestClient(
        _app(tmp_path, voice_auditioner=provider, voice_sample_auditioner=lambda *_: _wav())
    ) as client:
        book, package, accepted_bytes = _seed(client, tmp_path)
        generation_job = _submit(client, book)
        try:
            assert started.wait(3)
            response = client.post(
                f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload",
                data={"reference_text": "Exact uploaded words."},
                files={"file": ("sample.wav", _wav(), "audio/wav")},
            )
            assert response.status_code == 201, response.text
            uploaded = response.json()
        finally:
            release.set()
        failed = _terminal(client, generation_job)
        assert failed["status"] == "failed", failed
        assert "draft changed" in failed["error"]
        snapshot = client.get(f"/api/books/{book}/snapshot").json()
        assert snapshot["pendingCandidates"]["cast"]["revision"] == uploaded["revision"]
        candidate = uploaded["identities"][0]["voiceCandidates"][-1]
        assert client.get(candidate["previewUrl"]).status_code == 200
        assert (package / candidate["referenceAudio"]).read_bytes() == _wav()
        assert client.get(f"/api/books/{book}/voices/alice/alice-4/audio").status_code == 404
        assert (package / "artifacts/cast/accepted-before.json").read_bytes() == accepted_bytes
