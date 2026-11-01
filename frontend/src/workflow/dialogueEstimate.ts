import type { Job } from "../api/contracts";
import { generationDuration } from "./generation";

/** The first 15% is preparation; leave room for selective conflict resolution. */
export function remainingDialogueTime(job: Job | undefined, progress: number, expectedSeconds?: number, now = Date.now()) {
  if (job?.status === "queued") return "Waiting to start";
  if (job?.cancel_requested_at || job?.message?.startsWith("Stopping remaining speaker checks")) return "Finishing active requests…";
  if (progress >= 95) return "Almost done";
  const elapsed = job?.started_at ? Math.max(0, (now - Date.parse(job.started_at)) / 1000) : 0;
  const fraction = Math.max(0, Math.min(1, (progress - 15) / 80));
  if (Number.isFinite(elapsed) && elapsed >= 30 && fraction >= 0.05) {
    const remaining = elapsed * (1 - fraction) / fraction;
    return generationDuration(remaining, undefined, { fallbackLowerMultiplier: 0.8, fallbackUpperMultiplier: 1.5 });
  }
  if (!expectedSeconds || !Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return "Estimating…";
  if (elapsed > expectedSeconds * 1.5) return "Taking longer than expected; updating estimate…";
  return generationDuration(expectedSeconds, undefined, { fallbackLowerMultiplier: 0.75, fallbackUpperMultiplier: 1.5 });
}
