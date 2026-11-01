"""Bulk OCR continues into ordinary Review without another acceptance step."""
from copy import deepcopy
from pathlib import Path
import threading
import time
from uuid import uuid4

import pytest

from meowdiobooks.backend.artifacts import active_artifacts, artifact_history, read_artifact, write_artifact
from meowdiobooks.backend.app_v2 import create_app_v2
from fastapi.testclient import TestClient
from meowdiobooks.backend.review import build_review_workspace
from tests.backend.test_app_v2 import _accept, _process
from tests.backend import test_ocr_recovery

recovery = test_ocr_recovery.recovery


@pytest.fixture
def ready(recovery, monkeypatch):
    client, book_id, package, processor = recovery
    processed = _process(client, book_id, "dialogue", {"strategy": "narrate"})
    _accept(client, book_id, "dialogue", processed["revision"])
    accepted = read_artifact(package, "dialogue")
    manual = deepcopy(accepted)
    manual["revision"] = uuid4().hex
    manual["correctedFromRevision"] = accepted["revision"]
    original_span = next(row for row in manual["spans"] if row.get("text", "").strip() == "Original story.")
    original_span.update(renderRole="dialogue", speakerStatus="user", origin="user:dialogue-speaker",
                         resolvedSpeakerLabel="My chosen speaker", fallback=None)
    manual["partition"] = deepcopy(manual["spans"])
    write_artifact(package, "dialogue", manual)
    for kind in ["review", "cast", "script"]:
        write_artifact(package, kind, {"revision": f"old-{kind}"})
    class Reviewer:
        def __init__(self):
            self.callback = None
            self.calls = []

        def __call__(self, root, extraction, dialogue, report, **_kwargs):
            self.calls.append((deepcopy(extraction), deepcopy(dialogue)))
            if self.callback is not None:
                return self.callback(root, extraction, dialogue, report)
            return {"occurrences": []}
    reviewer = Reviewer()
    monkeypatch.setattr("meowdiobooks.backend.cleanup_remote.run_cleanup_review", reviewer)
    return client, book_id, package, processor, reviewer


def queue_review(client, book_id, package, pages, **overrides):
    settings = {"ocrPages": pages,
                "baseExtractionRevision": read_artifact(package, "extraction")["revision"],
                "baseDialogueRevision": read_artifact(package, "dialogue")["revision"], **overrides}
    response = client.post(f"/api/books/{book_id}/stages/review/process", json={"settings": settings})
    assert response.status_code == 202, response.text
    return response.json()["id"]


def settled(client, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"succeeded", "failed", "canceled"}:
            return job
        time.sleep(.01)
    raise AssertionError("OCR review job did not settle")


def test_bulk_ocr_keeps_blank_peer_and_preserves_manual_speaker_choices(ready):
    client, book_id, package, processor, reviewer = ready
    processor.results[2] = "Recovered useful image text."
    processor.results[3] = ""
    extraction = read_artifact(package, "extraction")
    dialogue = read_artifact(package, "dialogue")
    expected_spans = [row for row in dialogue["spans"] if row["page"] != 2]
    before = active_artifacts(package)
    seen_before_cleanup = []
    reviewer.callback = lambda *_args: seen_before_cleanup.append(active_artifacts(package)) or {"occurrences": []}

    job = settled(client, queue_review(client, book_id, package, [2, 3]))

    assert job["status"] == "succeeded", job
    assert seen_before_cleanup == [before]
    assert processor.calls == [("original.pdf", 2, "ocr"), ("original.pdf", 3, "ocr")]
    assert processor.full_calls == 1
    active = active_artifacts(package)
    assert set(active) == {"extraction", "dialogue"}
    recovered = read_artifact(package, "extraction")
    rebased = read_artifact(package, "dialogue")
    candidate = artifact_history(package, "review")[-1]
    assert recovered["pages"][0] == extraction["pages"][0]
    assert recovered["pages"][2] == extraction["pages"][2]
    assert [row for row in rebased["spans"] if row["page"] != 2] == expected_spans
    assert "correctedFromRevision" not in rebased
    assert rebased["recoveredFromDialogueRevision"] == dialogue["revision"]
    assert all(row["renderRole"] == "narration" for row in rebased["spans"] if row["page"] == 2)
    assert candidate["ocrRecovery"] == {
        "requestedPages": [2, 3], "recoveredPages": [2], "emptyPages": [3], "unchangedPages": [],
    }
    assert candidate["extractionRevision"] == recovered["revision"]
    assert candidate["dialogueRevision"] == rebased["revision"]
    assert build_review_workspace(recovered, rebased)["sourceReconstruction"]["status"] == "exact"
    snapshot = client.get(f"/api/books/{book_id}/snapshot")
    assert snapshot.status_code == 200, snapshot.text
    assert "extraction" not in snapshot.json()["pendingCandidates"]


def test_no_change_creates_only_a_normal_review_candidate(ready):
    client, book_id, package, processor, _reviewer = ready
    processor.results.update({2: "", 3: " Page 3\nPublisher "})
    before = active_artifacts(package)
    extraction_history = artifact_history(package, "extraction")
    dialogue_history = artifact_history(package, "dialogue")
    job = settled(client, queue_review(client, book_id, package, [2, 3]))
    assert job["status"] == "succeeded", job
    assert active_artifacts(package) == before
    assert artifact_history(package, "extraction") == extraction_history
    assert artifact_history(package, "dialogue") == dialogue_history
    candidate = artifact_history(package, "review")[-1]
    assert candidate["ocrRecovery"] == {
        "requestedPages": [2, 3], "recoveredPages": [], "emptyPages": [2], "unchangedPages": [3],
    }


def test_same_length_new_source_cannot_inherit_old_correction_ownership(ready):
    client, book_id, package, processor, _reviewer = ready
    dialogue = read_artifact(package, "dialogue")
    target = next(row for row in dialogue["spans"] if row["page"] == 3)
    target.update(renderRole="dialogue", speakerStatus="user", resolvedSpeakerLabel="Old speaker",
                  origin="user:dialogue-speaker", fallback=None)
    old_id = target["id"]
    dialogue.update(revision=uuid4().hex, partition=deepcopy(dialogue["spans"]),
                    aiTargetSpans=[deepcopy(target)],
                    userCorrections=[{"spanId": old_id, "spanIds": [old_id], "action": "speaker",
                                      "speakerLabel": "Old speaker", "provenance": "user"}],
                    aiWindows=[{"id": "old-window", "ownerIds": [old_id],
                                "dossiers": [{"spanId": old_id, "spanIds": [old_id]}]}])
    write_artifact(package, "dialogue", dialogue)
    processor.results[3] = "X" * len(target["source"])
    job = settled(client, queue_review(client, book_id, package, [3]))
    assert job["status"] == "succeeded", job
    rebased = read_artifact(package, "dialogue")
    assert next(row for row in rebased["spans"] if row["page"] == 3)["id"] == old_id
    assert rebased["userCorrections"] == []
    assert rebased["aiWindows"] == []
    assert rebased["aiTargetSpans"] == []


@pytest.mark.parametrize("failure", ["ocr", "cleanup", "invalid-output"])
def test_technical_failure_after_useful_peer_publishes_nothing(ready, failure):
    client, book_id, package, processor, reviewer = ready
    if failure == "ocr":
        processor.results[3] = RuntimeError("Private OCR failure")
    elif failure == "cleanup":
        def fail(*_args):
            raise RuntimeError("Private cleanup failure")
        reviewer.callback = fail
    else:
        original = processor.extract_pdf_page
        processor.extract_pdf_page = lambda *args: {"page": 4, "text": "Wrong."} if args[2] == 3 else original(*args)
    before = active_artifacts(package)
    histories = {kind: artifact_history(package, kind) for kind in ["extraction", "dialogue", "review"]}
    job = settled(client, queue_review(client, book_id, package, [2, 3]))
    assert job["status"] == "failed", job
    assert active_artifacts(package) == before
    assert all(artifact_history(package, kind) == value for kind, value in histories.items())


def test_cancellation_during_review_preparation_keeps_upstreams_and_no_pending_source(ready):
    client, book_id, package, _processor, reviewer = ready
    started, release = threading.Event(), threading.Event()
    def block(*_args):
        started.set()
        assert release.wait(3)
        return {"occurrences": []}
    reviewer.callback = block
    before = active_artifacts(package)
    history = artifact_history(package, "extraction")
    job_id = queue_review(client, book_id, package, [2, 3])
    assert started.wait(3)
    try:
        response = client.post(f"/api/jobs/{job_id}/cancel")
        assert response.status_code == 200, response.text
    finally:
        release.set()
    assert settled(client, job_id)["status"] == "canceled"
    assert active_artifacts(package) == before
    assert artifact_history(package, "extraction") == history


@pytest.mark.parametrize("revision_field", ["baseExtractionRevision", "baseDialogueRevision"])
def test_stale_requested_revisions_fail_before_ocr(ready, revision_field):
    client, book_id, package, processor, _reviewer = ready
    before = active_artifacts(package)
    job = settled(client, queue_review(client, book_id, package, [2], **{revision_field: "old-revision"}))
    assert job["status"] == "failed", job
    assert not processor.calls
    assert active_artifacts(package) == before


@pytest.mark.parametrize("kind", ["extraction", "dialogue"])
def test_upstream_change_during_cleanup_is_rechecked_before_publication(ready, kind):
    client, book_id, package, _processor, reviewer = ready
    changed = []
    def replace(*_args):
        value = {**read_artifact(package, kind), "revision": uuid4().hex}
        write_artifact(package, kind, value)
        changed.append(active_artifacts(package))
        return {"occurrences": []}
    reviewer.callback = replace
    histories = {name: len(artifact_history(package, name)) for name in ["extraction", "dialogue"]}
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "failed", job
    assert active_artifacts(package) == changed[0]
    assert len(artifact_history(package, kind)) == histories[kind] + 1
    other = "dialogue" if kind == "extraction" else "extraction"
    assert len(artifact_history(package, other)) == histories[other]


def test_source_hash_mismatch_prevents_ocr(ready):
    client, book_id, package, processor, _reviewer = ready
    source = package / "source/original.pdf"
    source.write_bytes(source.read_bytes() + b"changed")
    before = active_artifacts(package)
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "failed"
    assert job["error"] == "Import the source document again before continuing."
    assert not processor.calls
    assert active_artifacts(package) == before


def test_original_source_change_during_cleanup_is_rejected(ready):
    client, book_id, package, _processor, reviewer = ready
    source = package / "source/original.pdf"
    def change_source(*_args):
        source.write_bytes(source.read_bytes() + b"changed-after-ocr")
        return {"occurrences": []}
    reviewer.callback = change_source
    before = active_artifacts(package)
    histories = {kind: artifact_history(package, kind) for kind in ["extraction", "dialogue", "review"]}
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "failed", job
    assert job["error"] == "Import the source document again before continuing."
    assert active_artifacts(package) == before
    assert all(artifact_history(package, kind) == value for kind, value in histories.items())


def test_failed_atomic_pointer_write_removes_private_candidates(ready, monkeypatch):
    client, book_id, package, _processor, _reviewer = ready
    before = active_artifacts(package)
    histories = {kind: artifact_history(package, kind) for kind in ["extraction", "dialogue", "review"]}
    def fail(*_args):
        raise OSError("Pointer storage failed")
    monkeypatch.setattr("meowdiobooks.backend.workspace.write_json", fail)
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "failed", job
    assert active_artifacts(package) == before
    assert all(artifact_history(package, kind) == value for kind, value in histories.items())


def test_private_source_history_is_not_discovered_between_writes_and_publication(ready, monkeypatch):
    client, book_id, package, _processor, _reviewer = ready
    from meowdiobooks.backend import app_v2
    original = app_v2.write_artifact
    original_history = app_v2.artifact_history
    reading_history = threading.Event()
    observed = []
    readers = []
    def inspect_history(where, kind):
        result = original_history(where, kind)
        if readers and threading.current_thread().name != "meowdiobooks-worker" and kind == "extraction":
            reading_history.set()
        return result
    def snapshot():
        response = client.get(f"/api/books/{book_id}/snapshot")
        observed.append(response.json()["pendingCandidates"])
    def inspect_after_write(where, kind, payload, **options):
        result = original(where, kind, payload, **options)
        if kind == "extraction" and payload.get("publicationOwner") == "review-ocr":
            reader = threading.Thread(target=snapshot, name="ocr-snapshot")
            readers.append(reader)
            reader.start()
            assert reading_history.wait(2)
        return result
    monkeypatch.setattr(app_v2, "write_artifact", inspect_after_write)
    monkeypatch.setattr(app_v2, "artifact_history", inspect_history)
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "succeeded", job
    for reader in readers:
        reader.join(2)
        assert not reader.is_alive()
    assert len(observed) == 1
    assert all("extraction" not in row and "dialogue" not in row for row in observed)


def test_orphaned_review_ocr_history_never_opens_extra_acceptance_step(ready):
    client, book_id, package, _processor, _reviewer = ready
    before = active_artifacts(package)
    for kind in ["extraction", "dialogue"]:
        orphan = {**read_artifact(package, kind), "revision": uuid4().hex,
                  "publicationOwner": "review-ocr"}
        write_artifact(package, kind, orphan, publish=False)
    snapshot = client.get(f"/api/books/{book_id}/snapshot")
    assert snapshot.status_code == 200, snapshot.text
    assert "extraction" not in snapshot.json()["pendingCandidates"]
    assert "dialogue" not in snapshot.json()["pendingCandidates"]
    assert active_artifacts(package) == before
    with TestClient(create_app_v2(package.parent.parent)) as reopened:
        restored = reopened.get(f"/api/books/{book_id}/snapshot")
        assert restored.status_code == 200, restored.text
        assert "extraction" not in restored.json()["pendingCandidates"]
        assert "dialogue" not in restored.json()["pendingCandidates"]


def test_related_source_publication_uses_one_atomic_pointer_write(ready, monkeypatch):
    client, book_id, package, _processor, _reviewer = ready
    from meowdiobooks.backend import workspace
    original = workspace.write_json
    updates = []
    def record(path, value):
        updates.append((path, deepcopy(value)))
        assert all(Path(location).is_file() for location in value.values())
        original(path, value)
    monkeypatch.setattr(workspace, "write_json", record)
    job = settled(client, queue_review(client, book_id, package, [2]))
    assert job["status"] == "succeeded", job
    assert len(updates) == 1
    assert updates[0][0] == package / "artifacts/latest.json"
    assert set(updates[0][1]) == {"extraction", "dialogue"}


def test_dialogue_acceptance_validated_before_ocr_cannot_overwrite_recovered_source(ready, monkeypatch):
    client, book_id, package, _processor, _reviewer = ready
    from meowdiobooks.backend.workspace import BookWorkspace
    publish = BookWorkspace.publish_many
    validated, release = threading.Event(), threading.Event()
    responses = []
    def pause_old_dialogue(self, paths, **options):
        if set(paths) == {"dialogue"} and threading.current_thread().name != "meowdiobooks-worker":
            validated.set()
            assert release.wait(4)
        return publish(self, paths, **options)
    monkeypatch.setattr(BookWorkspace, "publish_many", pause_old_dialogue)
    old = read_artifact(package, "dialogue")
    def accept_old():
        responses.append(client.post(f"/api/books/{book_id}/stages/dialogue/accept", json={
            "revision": old["revision"], "decisions": [],
        }))
    accepting = threading.Thread(target=accept_old)
    accepting.start()
    try:
        assert validated.wait(2)
        job = settled(client, queue_review(client, book_id, package, [2]))
        assert job["status"] == "succeeded", job
        recovered = active_artifacts(package)
    finally:
        release.set()
        accepting.join(3)
    assert not accepting.is_alive()
    assert len(responses) == 1 and responses[0].status_code == 409
    assert active_artifacts(package) == recovered
    assert read_artifact(package, "dialogue")["revision"] != old["revision"]


@pytest.mark.parametrize("settings", [
    {"ocrPages": [2]}, {"baseExtractionRevision": "e", "baseDialogueRevision": "d"},
    {"ocrPages": [0], "baseExtractionRevision": "e", "baseDialogueRevision": "d"},
    {"ocrPages": [True], "baseExtractionRevision": "e", "baseDialogueRevision": "d"},
    {"ocrPages": [2, 2], "baseExtractionRevision": "e", "baseDialogueRevision": "d"},
])
def test_invalid_bulk_settings_are_rejected_before_queueing(ready, settings):
    client, book_id, _package, processor, _reviewer = ready
    response = client.post(f"/api/books/{book_id}/stages/review/process", json={"settings": settings})
    assert response.status_code == 422
    assert not processor.calls
