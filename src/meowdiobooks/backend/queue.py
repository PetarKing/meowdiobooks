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
        """Cancel queued work; running work deliberately has no unsafe stop path."""

        def apply(job: Job) -> Job:
            if job.status != JobStatus.QUEUED:
                raise ValueError("Only queued jobs can be canceled")
            job.status = JobStatus.CANCELED
            job.message = "Canceled before starting"
            job.error = None
            job.finished_at = utc_now()
            job.updated_at = utc_now()
            return job

        canceled = self.store.update(job_id, apply)
        with self._condition:
            self._condition.notify_all()
        return canceled

    def _recover_interrupted_jobs(self) -> None:
        for job in self.store.all():
            if job.status == JobStatus.RUNNING:
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

            def report(progress: float, message: str | None = None) -> None:
                def apply(current: Job) -> Job:
                    if current.status == JobStatus.RUNNING:
                        current.progress = min(100, max(current.progress, progress))
                        current.message = message
                        current.updated_at = utc_now()
                    return current

                self.store.update(job.id, apply)

            if self._before_run is not None:
                self._before_run(job)
            with self._activity():
                if len(inspect.signature(handler).parameters) >= 2:
                    result = handler(job.payload, report) or {}
                else:
                    result = handler(job.payload) or {}
            job.status = JobStatus.SUCCEEDED
            job.result = result
            job.progress = 100
            job.message = "Complete"
        except Exception as exc:  # the worker must survive individual job failures
            job.status = JobStatus.FAILED
            job.error = str(
                getattr(exc, "public_message", f"{type(exc).__name__}: {exc}")
            )
            job.message = "Failed"
        job.finished_at = utc_now()
        job.updated_at = utc_now()
        self.store.put(job)
