"""Process-wide cleanup limits shared by book screening and script-cue checks.

These bound provider calls in this process, not across independently deployed workers.
Keep a slot through retries. Transport admission must check cancellation before every
paid attempt; this gate additionally checks it while waiting for another request to finish.
"""
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from threading import BoundedSemaphore, Lock
from time import monotonic
from typing import Literal

MAX_DECISIONS_REQUESTS = 40
MAX_REPAIR_REQUESTS = 4
_SLOTS = {
    "decisions": BoundedSemaphore(MAX_DECISIONS_REQUESTS),
    "repair": BoundedSemaphore(MAX_REPAIR_REQUESTS),
}


def cancellation_poll(
    check_stopped: Callable[[], None], check_cancelled: Callable[[], None],
) -> Callable[[], None]:
    """Share one expensive cancellation check per 0.1s among this job's waiting threads.

    This callback is only for gate contention. Transport admission must always perform
    its uncached check before each paid attempt, regardless of this polling interval.
    """
    lock = Lock()
    next_check = 0.0

    def poll():
        nonlocal next_check
        check_stopped()
        with lock:
            check_stopped()
            if monotonic() >= next_check:
                check_cancelled()
                next_check = monotonic() + 0.1

    return poll


@contextmanager
def request_slot(
    kind: Literal["decisions", "repair"], check_cancelled: Callable[[], None],
) -> Iterator[None]:
    """Poll cancellation only when blocked; the transport checks it again on admission."""
    gate = _SLOTS[kind]
    while not gate.acquire(timeout=0.1):
        check_cancelled()
    try:
        yield
    finally:
        gate.release()
