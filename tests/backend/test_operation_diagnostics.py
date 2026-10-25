"""Synchronous voice operations keep private failures out of API responses."""

import pytest
from fastapi.testclient import TestClient

from meowdiobooks.backend.errors import WorkflowInputError
from tests.backend.test_audition_publication import _app, _seed, _wav
from tests.backend.test_action_required import RequiredAction


@pytest.mark.parametrize("operation", ["transcribe", "clone"])
@pytest.mark.parametrize("failure_kind", ["runtime", "value", "action", "reporter"])
def test_voice_operation_failure_boundary(tmp_path, monkeypatch, caplog, operation, failure_kind):
    error = RequiredAction("private action diagnostic") if failure_kind == "action" else (
        ValueError("private SDK diagnostic") if failure_kind == "value"
        else RuntimeError("private worker diagnostic")
    )
    reports = []
    samples = []

    def fail(*args):
        if operation == "transcribe":
            samples.append(args[-1])
        raise error

    def report(*args):
        reports.append(args)
        if failure_kind == "reporter":
            raise RuntimeError("private reporter diagnostic")

    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", lambda *_: (_wav(), 4))
    with TestClient(_app(tmp_path, voice_sample_transcriber=fail, voice_sample_auditioner=fail,
                         on_operation_failed=report)) as client:
        book, package, accepted = _seed(client, tmp_path)
        before = set(package.rglob("*.wav"))
        path = (f"/api/books/{book}/voice-samples/transcribe" if operation == "transcribe" else
                f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload")
        response = client.post(path, data={"reference_text": "Exact words."},
                               files={"file": ("sample.wav", _wav(), "audio/wav")})

    assert response.status_code in {402, 422, 503}
    assert "private" not in response.text
    assert "private" not in caplog.text
    assert set(package.rglob("*.wav")) == before
    assert all(not sample.exists() for sample in samples)
    if failure_kind == "action":
        assert response.status_code == 402
        assert reports == []
    else:
        assert reports == [(operation, book, error)]


def test_transcription_validation_remains_actionable_without_failure_report(tmp_path, monkeypatch):
    reports = []

    def invalid(*_args):
        raise WorkflowInputError("input invalid", public_message="Voice sample is silent")

    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", invalid)
    with TestClient(_app(tmp_path, on_operation_failed=lambda *args: reports.append(args))) as client:
        book, _, _ = _seed(client, tmp_path)
        response = client.post(f"/api/books/{book}/voice-samples/transcribe",
                               files={"file": ("sample.wav", b"silent", "audio/wav")})
    assert response.status_code == 422
    assert response.json()["detail"] == "Voice sample is silent"
    assert reports == []


@pytest.mark.parametrize("operation", ["transcribe", "clone"])
@pytest.mark.parametrize("error_type", [ValueError, RuntimeError, OSError])
def test_voice_normalization_failures_are_private(tmp_path, monkeypatch, operation, error_type):
    reports = []
    error = error_type("private decoder diagnostic")

    def fail(*_args):
        raise error

    monkeypatch.setattr("meowdiobooks.backend.app_v2.normalize_voice_sample", fail)
    with TestClient(_app(tmp_path, on_operation_failed=lambda *args: reports.append(args))) as client:
        book, package, _ = _seed(client, tmp_path)
        before = set(package.rglob("*.wav"))
        path = (f"/api/books/{book}/voice-samples/transcribe" if operation == "transcribe" else
                f"/api/books/{book}/stages/cast/candidates/editable/voices/alice/upload")
        response = client.post(path, data={"reference_text": "Exact words."},
                               files={"file": ("sample.wav", b"voice", "audio/wav")})
    assert response.status_code in {422, 503}
    assert "private" not in response.text
    assert reports == [(operation, book, error)]
    assert set(package.rglob("*.wav")) == before
