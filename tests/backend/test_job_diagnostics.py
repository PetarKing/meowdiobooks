"""Private job failures are observable without exposing diagnostics in job responses."""

import pytest

from meowdiobooks.backend.models import Job, JobStatus
from meowdiobooks.backend.queue import JobCancellationRequested, JobQueue
from meowdiobooks.backend.storage import JsonStore
from meowdiobooks.backend.workflow import PUBLIC_WORKFLOW
from tests.backend.test_storage_queue import wait_for


@pytest.mark.parametrize("kind", PUBLIC_WORKFLOW.command_kinds)
def test_all_workflow_jobs_report_original_failure(tmp_path, caplog, kind):
    error = RuntimeError("private provider diagnostics")
    reports = []
    store = JsonStore(tmp_path / "jobs.json", Job)

    def fail(_payload):
        raise error

    def record(job, failure):
        assert store.get(job.id).status == JobStatus.FAILED
        reports.append((job, failure))

    queue = JobQueue(store, {kind: fail}, on_job_failed=record)
    submitted = queue.enqueue(kind, {"book_id": "book"}, attempt=2)
    queue._run(submitted)

    failed = store.get(submitted.id)
    assert failed.error == "Something went wrong while completing this step. Try again; your accepted work is unchanged."
    assert reports == [(failed, error)]
    assert reports[0][1].__traceback__ is not None
    assert failed.attempt == 2
    assert "private provider diagnostics" not in caplog.text


def test_default_failure_log_retains_traceback_and_job_context(tmp_path, caplog):
    store = JsonStore(tmp_path / "jobs.json", Job)

    def fail(_payload):
        raise RuntimeError("private local diagnostic")

    queue = JobQueue(store, {"v2:generate": fail})
    submitted = queue.enqueue("v2:generate")
    queue._run(submitted)

    assert submitted.id in caplog.text
    assert "v2:generate" in caplog.text
    assert "private local diagnostic" in caplog.text
    assert caplog.records[-1].exc_info is not None
    assert "private local diagnostic" not in store.get(submitted.id).error


def test_failed_reporter_cannot_expose_diagnostics_or_stop_worker(tmp_path, caplog):
    store = JsonStore(tmp_path / "jobs.json", Job)

    def fail(_payload):
        raise RuntimeError("private provider diagnostic")

    def failed_reporter(_job, _error):
        raise RuntimeError("private reporter diagnostic")

    queue = JobQueue(store, {"fail": fail, "ok": lambda _: {"alive": True}},
                     on_job_failed=failed_reporter)
    queue.start()
    try:
        failed = wait_for(store, queue.enqueue("fail").id, JobStatus.FAILED)
        completed = wait_for(store, queue.enqueue("ok").id, JobStatus.SUCCEEDED)
    finally:
        queue.stop()

    assert completed.result["alive"] is True
    assert "reporter failed" in caplog.text
    assert failed.id in caplog.text
    assert "private" not in caplog.text
    assert "private" not in failed.error


@pytest.mark.parametrize("outcome", ["action", "cancel", "cancel_requested", "committed"])
def test_expected_outcomes_do_not_report_failure(tmp_path, caplog, outcome):
    store = JsonStore(tmp_path / "jobs.json", Job)
    reports = []

    def handler(payload, report):
        if outcome == "action":
            error = RuntimeError("private policy diagnostic")
            error.action_required = {
                "code": "REVIEW", "message": "Review before continuing.", "context": {},
            }
            raise error
        if outcome == "cancel":
            raise JobCancellationRequested
        if outcome == "cancel_requested":
            queue.cancel(payload["_job_id"])
        if outcome == "committed":
            report.commit(lambda: {"published": True})
        raise RuntimeError("private late diagnostic")

    queue = JobQueue(store, {"run": handler}, on_job_failed=lambda *args: reports.append(args))
    submitted = queue.enqueue("run")
    queue._run(submitted)
    finished = store.get(submitted.id)

    assert reports == []
    assert not caplog.records
    if outcome == "action":
        assert finished.status == JobStatus.FAILED
        assert finished.error == "Review before continuing."
    elif outcome == "committed":
        assert finished.status == JobStatus.SUCCEEDED
        assert finished.result == {"published": True}
    else:
        assert finished.status == JobStatus.CANCELED
        assert finished.error is None
