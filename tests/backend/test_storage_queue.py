import time
import threading
import pytest

from meowdiobooks.backend.models import Book, Job, JobStatus, StageRevision, WizardStage
from meowdiobooks.backend.queue import JobQueue
from meowdiobooks.backend.storage import JsonStore
from meowdiobooks.backend.workflow.runtime import commit_publication


def wait_for(store: JsonStore[Job], job_id: str, status: JobStatus) -> Job:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        job = store.get(job_id)
        if job is not None and job.status == status:
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {status}")


def test_store_round_trip(tmp_path):
    path = tmp_path / "books.json"
    original = JsonStore(path, Book).put(Book(title="The Left Paw of Darkness"))

    restored = JsonStore(path, Book).get(original.id)

    assert restored == original
    assert not list(tmp_path.glob(".books.json.*"))


def test_book_preserves_accepted_stage_revision_history(tmp_path):
    store = JsonStore(tmp_path / "books.json", Book)
    book = Book(
        title="The Left Paw of Darkness",
        stage=WizardStage.EXTRACT,
        accepted_stage_revisions=[
            StageRevision(stage=WizardStage.IMPORT, revision=1, data={"source": "novel.pdf"}),
            StageRevision(stage=WizardStage.EXTRACT, revision=1, data={"chapters": 12}),
            StageRevision(stage=WizardStage.EXTRACT, revision=2, data={"chapters": 13}),
        ],
    )

    restored = JsonStore(tmp_path / "books.json", Book)
    store.put(book)

    revisions = restored.get(book.id).accepted_stage_revisions
    assert [item.stage for item in revisions] == [
        WizardStage.IMPORT,
        WizardStage.EXTRACT,
        WizardStage.EXTRACT,
    ]
    assert [item.revision for item in revisions] == [1, 1, 2]


def test_store_persists_related_updates_together(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    first = Job(kind="first")
    second = Job(kind="second")

    store.put_many([first, second])

    assert {job.id for job in store.all()} == {first.id, second.id}


def test_queue_runs_one_job_and_persists_result(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"echo": lambda payload: {"value": payload["value"]}})
    queue.start()
    try:
        submitted = queue.enqueue("echo", {"value": 42})
        completed = wait_for(store, submitted.id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()

    assert completed.result == {"value": 42}


def test_queue_persists_monotonic_progress(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)

    def handler(payload, report):
        report(25, "Quarter way")
        report(70, "Nearly there")
        return payload

    queue = JobQueue(store, {"progress": handler})
    queue.start()
    try:
        submitted = queue.enqueue("progress", {"ok": True})
        completed = wait_for(store, submitted.id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()

    assert completed.progress == 100
    assert completed.message == "Complete"
    assert completed.started_at is not None
    assert completed.finished_at is not None


def test_queue_recovers_interrupted_job(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    interrupted = Job(kind="echo", status=JobStatus.RUNNING)
    store.put(interrupted)

    JobQueue(store, {"echo": lambda payload: payload})

    recovered = store.get(interrupted.id)
    assert recovered.status == JobStatus.FAILED
    assert recovered.error.startswith("ApplicationInterrupted")


def test_unknown_job_failure_does_not_kill_worker(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"ok": lambda payload: payload})
    queue.start()
    try:
        failed_id = queue.enqueue("unknown").id
        wait_for(store, failed_id, JobStatus.FAILED)
        successful_id = queue.enqueue("ok", {"alive": True}).id
        completed = wait_for(store, successful_id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()

    assert completed.result["alive"] is True
    assert completed.result["_job_id"] == successful_id


def test_queue_uses_public_error_message_when_available(tmp_path):
    class RecoverableFailure(RuntimeError):
        public_message = "Try this step again; accepted work is unchanged."

    def fail(_payload):
        raise RecoverableFailure("private transport diagnostics")

    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"fail": fail})
    queue.start()
    try:
        failed = wait_for(store, queue.enqueue("fail").id, JobStatus.FAILED)
    finally:
        queue.stop()

    assert failed.error == "Try this step again; accepted work is unchanged."
    assert "private transport diagnostics" not in failed.error


def test_queued_job_can_be_canceled_without_running(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"echo": lambda payload: payload})
    submitted = queue.enqueue("echo", {"value": 42})

    canceled = queue.cancel(submitted.id)

    assert canceled.status == JobStatus.CANCELED
    queue.start()
    time.sleep(0.03)
    queue.stop()
    assert store.get(submitted.id).status == JobStatus.CANCELED


def test_running_job_stops_at_the_next_progress_boundary(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    started = threading.Event()
    release = threading.Event()

    def wait_handler(_payload, report):
        started.set()
        release.wait(1)
        report(50, "First task complete")
        return {}

    queue = JobQueue(store, {"wait": wait_handler})
    queue.start()
    submitted = queue.enqueue("wait")
    wait_for(store, submitted.id, JobStatus.RUNNING)
    assert started.wait(1)

    try:
        requested = queue.cancel(submitted.id)
        assert requested.status == JobStatus.RUNNING
        assert requested.cancel_requested_at is not None
        assert requested.message == "Cancellation requested; stopping after the active task"
        release.set()
        canceled = wait_for(store, submitted.id, JobStatus.CANCELED)
    finally:
        release.set()
        queue.stop()

    assert canceled.error is None
    assert canceled.result is None
    assert canceled.message == "Canceled after the active task"


def test_running_job_canceled_after_a_handler_without_progress_cannot_publish_success(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    release = threading.Event()

    def wait_handler(_payload):
        release.wait(1)
        return {"published": True}

    queue = JobQueue(store, {"wait": wait_handler})
    queue.start()
    submitted = queue.enqueue("wait")
    wait_for(store, submitted.id, JobStatus.RUNNING)

    try:
        queue.cancel(submitted.id)
        release.set()
        canceled = wait_for(store, submitted.id, JobStatus.CANCELED)
    finally:
        release.set()
        queue.stop()

    assert canceled.result is None


def test_cancel_rejects_finished_job(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"echo": lambda payload: payload})
    queue.start()
    try:
        submitted = queue.enqueue("echo")
        wait_for(store, submitted.id, JobStatus.SUCCEEDED)
        try:
            queue.cancel(submitted.id)
        except ValueError as error:
            assert str(error) == "Only queued or running jobs can be canceled"
        else:
            raise AssertionError("finished cancellation must be rejected")
    finally:
        queue.stop()


def test_retry_payload_is_rebound_to_the_new_attempt(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    queue = JobQueue(store, {"echo": lambda payload: dict(payload)})
    queue.start()
    try:
        retried = queue.enqueue("echo", {"_job_id": "previous-attempt"}, retry_of="old")
        completed = wait_for(store, retried.id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()

    assert completed.result["_job_id"] == retried.id


def test_cancellation_before_publication_prevents_callback_execution(tmp_path):
    store = JsonStore(tmp_path / "jobs.json", Job)
    started, release = threading.Event(), threading.Event()
    published = []

    def handler(_payload, report):
        started.set()
        assert release.wait(2)
        return commit_publication(report, lambda: published.append(True) or {"ok": True}, "Ready")

    queue = JobQueue(store, {"publish": handler})
    queue.start()
    try:
        job = queue.enqueue("publish")
        assert started.wait(2)
        queue.cancel(job.id)
        release.set()
        wait_for(store, job.id, JobStatus.CANCELED)
    finally:
        release.set()
        queue.stop()
    assert published == []


@pytest.mark.parametrize("after_commit_error", [False, True])
def test_publication_wins_cancellation_race_and_committed_result_is_not_downgraded(tmp_path, after_commit_error):
    store = JsonStore(tmp_path / "jobs.json", Job)
    publishing, release = threading.Event(), threading.Event()
    cancel_started = threading.Event()
    cancellation_errors = []

    def handler(_payload, report):
        def publish():
            publishing.set()
            assert release.wait(2)
            return {"committed": True}
        commit_publication(report, publish, "Ready")
        if after_commit_error:
            raise RuntimeError("An error after the irrevocable publication boundary")
        return {"must_not_replace_committed_result": True}

    queue = JobQueue(store, {"publish": handler})
    queue.start()
    job = queue.enqueue("publish")
    assert publishing.wait(2)

    def cancel():
        cancel_started.set()
        try:
            queue.cancel(job.id)
        except ValueError as error:
            cancellation_errors.append(str(error))

    thread = threading.Thread(target=cancel)
    thread.start()
    try:
        assert cancel_started.wait(2)
        thread.join(0.02)
        assert thread.is_alive(), "Cancellation must wait for the atomic publication update"
        release.set()
        thread.join(2)
        completed = wait_for(store, job.id, JobStatus.SUCCEEDED)
    finally:
        release.set()
        thread.join(2)
        queue.stop()
    assert cancellation_errors == ["Only queued or running jobs can be canceled"]
    assert completed.result == {"committed": True}
    assert completed.error is None


def test_direct_reporters_remain_compatible_with_final_publication():
    observed = []
    result = commit_publication(lambda progress, message: observed.append((progress, message)),
                                lambda: {"published": True}, "Ready")
    assert observed == [(100, "Ready")]
    assert result == {"published": True}
