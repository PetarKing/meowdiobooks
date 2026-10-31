import type { Job, WorkflowGateway } from "../api/contracts";

export const jobPollIntervalMs = 750;
export const maximumJobPollBackoffMs = 5_000;
export const reconnectingJobMessage = "Reconnecting to processing status…";

function listenForJobPollWake(wake: () => void) {
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") wake();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
  };
}

export function waitForNextJobPoll(delayMs: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      removeWakeListeners();
      resolve();
    };
    const removeWakeListeners = listenForJobPollWake(finish);
    const timer = window.setTimeout(finish, delayMs);
  });
}

export function pollJobWithForegroundRefresh(gateway: WorkflowGateway, jobId: string) {
  return new Promise<Job>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      removeWakeListeners();
    };
    const poll = () => {
      void gateway.getJob(jobId)
        .then((job) => {
          if (settled) return;
          finish();
          resolve(job);
        })
        .catch((reason) => {
          if (settled) return;
          finish();
          reject(reason);
        });
    };
    const removeWakeListeners = listenForJobPollWake(poll);
    poll();
  });
}

export function isRetryableJobPollError(reason: unknown) {
  if (!reason || typeof reason !== "object" || !("status" in reason)) return true;
  const status = Number((reason as { status?: unknown }).status);
  return !Number.isFinite(status) || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}
