"""Required host actions survive queue persistence and synchronous voice boundaries."""

import json

from fastapi.testclient import TestClient
import pytest

from meowdiobooks.backend.action_required import extract_action_required
from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import read_artifact
from meowdiobooks.backend.models import Job, JobStatus
from meowdiobooks.backend.queue import JobQueue
from meowdiobooks.backend.storage import JsonStore
from tests.backend.test_storage_queue import wait_for
from tests.backend.test_app_v2_finish import _pdf
from tests.backend.test_audition_publication import _app, _seed, _wav


ACTION = {"code": "HOST_REVIEW_REQUIRED", "message": "Review before continuing.", "context": {"stage": "cast"}}


class RequiredAction(RuntimeError):
    action_required = ACTION
    public_message = ACTION["message"]
    status_code = 402


def _require_action(*_args):
    raise RequiredAction("private diagnostics")


def test_queue_retains_required_action_and_survives_next_job(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"blocked": _require_action, "safe": lambda _: {"done": True}})
    queue.start()
    try:
        failed = wait_for(store, queue.enqueue("blocked", {"book_id": "book", "settings": {"language": "english"}}).id, JobStatus.FAILED)
        completed = wait_for(store, queue.enqueue("safe").id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()
    restored = JsonStore(tmp_path / "jobs.json", Job).get(failed.id)
    assert restored.model_dump(mode="json")["action_required"] == ACTION
    assert restored.message == "Action required"
    assert restored.payload["settings"] == {"language": "english"}
    assert restored.error == ACTION["message"]
    assert completed.action_required is None


@pytest.mark.parametrize("value", [{}, {"code": "x", "message": "ok", "context": []}, {"code": "x", "message": "ok", "context": {"value": object()}}])
def test_malformed_or_unserializable_descriptor_does_not_replace_failure(value):
    error = RuntimeError("ordinary failure")
    error.action_required = value
    assert extract_action_required(error) is None


def test_transcription_preserves_action_and_cleans_temporary_upload(tmp_path, monkeypatch):
    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", lambda *_: (b"normalized", 4))
    samples = []

    def blocked(_root, _book, path):
        samples.append(path)
        _require_action()

    with TestClient(create_app_v2(tmp_path, voice_sample_transcriber=blocked)) as client:
        book = client.post("/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}).json()["book"]["id"]
        response = client.post(f"/api/books/{book}/voice-samples/transcribe", files={"file": ("sample.wav", b"voice", "audio/wav")})
    assert response.status_code == 402
    assert response.json() == {"detail": {"actionRequired": ACTION}}
    assert samples and not samples[0].exists()
    assert "private diagnostics" not in response.text


def test_clone_preserves_action_without_publishing_or_retaining_new_audio(tmp_path, monkeypatch):
    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", lambda *_: (_wav(), 4))
    with TestClient(_app(tmp_path, voice_sample_auditioner=_require_action)) as client:
        book, package, accepted = _seed(client, tmp_path)
        before = set(package.rglob("*.wav"))
        response = client.post(f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload",
                               data={"reference_text": "Exact words."}, files={"file": ("sample.wav", _wav(), "audio/wav")})
    assert response.status_code == 402, response.text
    assert response.json() == {"detail": {"actionRequired": ACTION}}
    assert set(package.rglob("*.wav")) == before
    assert read_artifact(package, "cast") == json.loads(accepted)
