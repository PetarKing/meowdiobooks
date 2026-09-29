"""A single-worker, filesystem-persisted job queue."""

import inspect
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext

from .models import Job, JobStatus, utc_now
from .storage import ModelStore

JobHandler = Callable[..., dict[str, object] | None]
BeforeRun = Callable[[Job], None]
ActivityFactory = Callable[[], AbstractContextManager[object]]


class JobCancellationRequested(RuntimeError):
    """Stop cooperative work at the next safe progress boundary."""


class _JobReporter:
    def __init__(self, store: ModelStore[Job], job_id: str) -> None:
        self.store = store
        self.job_id = job_id

    def __call__(self, progress: float, message: str | None = None) -> None:
        def apply(current: Job) -> Job:
            if current.cancel_requested_at is not None:
                raise JobCancellationRequested
            if current.status == JobStatus.RUNNING:
                current.progress = min(100, max(current.progress, progress))
                current.message = message
                current.updated_at = utc_now()
            return current

        self.store.update(self.job_id, apply)

    def commit(self, publish: Callable[[], dict[str, object]]) -> dict[str, object]:
        """Cancellation and final publication contend on the same atomic store update."""

        def apply(current: Job) -> Job:
            if current.cancel_requested_at is not None:
                raise JobCancellationRequested
            if current.status != JobStatus.RUNNING:
                raise RuntimeError("Only a running job may commit its result")
            current.result = publish()
            current.status = JobStatus.SUCCEEDED
            current.progress = 100
            current.message = "Complete"
            current.finished_at = utc_now()
            current.updated_at = current.finished_at
            return current

        committed = self.store.update(self.job_id, apply)
        if committed is None:
            raise RuntimeError("Job disappeared before publication")
        return committed.result or {}


class JobQueue:
    def __init__(
        self,
        store: ModelStore[Job],
        handlers: dict[str, JobHandler] | None = None,
        *,
        before_run: BeforeRun | None = None,
        activity: ActivityFactory | None = None,
    ) -> None:
        self.store = store
        self.handlers = handlers or {}
        self._condition = threading.Condition()
        self._stop = False
        self._thread: threading.Thread | None = None
        self._before_run = before_run
        self._activity = activity or nullcontext
        self._recover_interrupted_jobs()

    def register(self, kind: str, handler: JobHandler) -> None:
        self.handlers[kind] = handler

    def start(self) -> None:
        with self._condition:
            if self._thread and self._thread.is_alive():
                return
            self._stop = False
            self._thread = threading.Thread(
                target=self._work, name="meowdiobooks-worker", daemon=True
            )
            self._thread.start()

    def stop(self, timeout: float = 5) -> None:
        with self._condition:
            self._stop = True
            self._condition.notify_all()
        if self._thread:
            self._thread.join(timeout)

    def enqueue(
        self,
        kind: str,
        payload: dict[str, object] | None = None,
        *,
        retry_of: str | None = None,
        attempt: int = 1,
    ) -> Job:
        job = self.store.put(
            Job(kind=kind, payload=payload or {}, retry_of=retry_of, attempt=attempt)
        )
        with self._condition:
            self._condition.notify()
        return job

    def cancel(self, job_id: str) -> Job | None:
        """Cancel queued work or ask running work to stop at its next safe boundary."""

        def apply(job: Job) -> Job:
            now = utc_now()
            if job.status == JobStatus.QUEUED:
                job.status = JobStatus.CANCELED
                job.message = "Canceled before starting"
                job.error = None
                job.cancel_requested_at = now
                job.finished_at = now
                job.updated_at = now
                return job
            if job.status != JobStatus.RUNNING:
                raise ValueError("Only queued or running jobs can be canceled")
            if job.cancel_requested_at is None:
                job.cancel_requested_at = now
                job.message = "Cancellation requested; stopping after the active task"
                job.updated_at = now
            return job

        canceled = self.store.update(job_id, apply)
        with self._condition:
            self._condition.notify_all()
        return canceled

    def _recover_interrupted_jobs(self) -> None:
        for job in self.store.all():
            if job.status == JobStatus.RUNNING:
                if job.cancel_requested_at is not None:
                    job.status = JobStatus.CANCELED
                    job.error = None
                    job.message = "Canceled after the application stopped"
                else:
                    job.status = JobStatus.FAILED
                    job.error = "ApplicationInterrupted: the app stopped while this stage was running"
                    job.message = "Interrupted; retry this stage from the beginning"
                job.finished_at = utc_now()
                job.updated_at = utc_now()
                self.store.put(job)

    def _next(self) -> Job | None:
        queued = (job for job in self.store.all() if job.status == JobStatus.QUEUED)
        return min(queued, key=lambda job: job.created_at, default=None)

    def _work(self) -> None:
        while True:
            with self._condition:
                job = self._next()
                while job is None and not self._stop:
                    self._condition.wait()
                    job = self._next()
                if self._stop:
                    return
            self._run(job)

    def _run(self, job: Job) -> None:
        handler = self.handlers.get(job.kind)

        def start(current: Job) -> Job:
            if current.status != JobStatus.QUEUED:
                return current
            current.status = JobStatus.RUNNING
            current.progress = 0
            current.message = "Starting"
            current.started_at = utc_now()
            current.finished_at = None
            current.updated_at = utc_now()
            current.payload["_job_id"] = current.id
            return current

        job = self.store.update(job.id, start) or job
        if job.status != JobStatus.RUNNING:
            return
        try:
            if handler is None:
                raise ValueError(f"No handler registered for job kind: {job.kind}")

            report = _JobReporter(self.store, job.id)

            if self._before_run is not None:
                self._before_run(job)
            self._raise_if_cancellation_requested(job.id)
            with self._activity():
                if len(inspect.signature(handler).parameters) >= 2:
                    result = handler(job.payload, report) or {}
                else:
                    result = handler(job.payload) or {}
            self._raise_if_cancellation_requested(job.id)
        except Exception as exc:  # the worker must survive individual job failures
            failure = exc

            def fail(current: Job) -> Job:
                if current.status == JobStatus.SUCCEEDED:
                    return current
                if isinstance(failure, JobCancellationRequested) or current.cancel_requested_at:
                    return self._finish_canceled(current)
                current.status = JobStatus.FAILED
                current.error = str(
                    getattr(
                        failure,
                        "public_message",
                        f"{type(failure).__name__}: {failure}",
                    )
                )
                current.message = "Failed"
                current.finished_at = utc_now()
                current.updated_at = current.finished_at
                return current

            self.store.update(job.id, fail)
            return

        def succeed(current: Job) -> Job:
            if current.status == JobStatus.SUCCEEDED:
                return current
            if current.cancel_requested_at is not None:
                return self._finish_canceled(current)
            current.status = JobStatus.SUCCEEDED
            current.result = result
            current.progress = 100
            current.message = "Complete"
            current.finished_at = utc_now()
            current.updated_at = current.finished_at
            return current

        self.store.update(job.id, succeed)

    def _raise_if_cancellation_requested(self, job_id: str) -> None:
        current = self.store.get(job_id)
        if current is not None and current.cancel_requested_at is not None:
            raise JobCancellationRequested

    @staticmethod
    def _finish_canceled(job: Job) -> Job:
        job.status = JobStatus.CANCELED
        job.result = None
        job.error = None
        job.message = "Canceled after the active task"
        job.finished_at = utc_now()
        job.updated_at = job.finished_at
        return job
