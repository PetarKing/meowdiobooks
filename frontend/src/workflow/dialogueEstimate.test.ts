import { describe, expect, it } from "vitest";
import type { Job } from "../api/contracts";
import { remainingDialogueTime } from "./dialogueEstimate";

const job = { kind: "v2:dialogue", status: "running", started_at: "2026-01-01T00:00:00Z" } as Job;
const started = Date.parse(job.started_at!);

describe("dialogue duration estimate", () => {
  it("shows a calibrated initial range without treating preparation as completed analysis", () => {
    expect(remainingDialogueTime(job, 15, 600, started + 1000)).toBe("≈ 8 min–15 min");
    expect(remainingDialogueTime({ ...job, status: "queued" }, 0, 600)).toBe("Waiting to start");
  });

  it("updates from measured work and keeps a range for conflict checks and retries", () => {
    expect(remainingDialogueTime(job, 55, 600, started + 300_000)).toBe("≈ 4 min–8 min");
    expect(remainingDialogueTime(job, 95, 600, started + 300_000)).toBe("Almost done");
  });

  it("does not show zero remaining when progress is delayed", () => {
    expect(remainingDialogueTime(job, 15, 600, started + 1000_000)).toBe("Taking longer than expected; updating estimate…");
    expect(remainingDialogueTime(job, 15, undefined, started + 1000_000)).toBe("Estimating…");
    expect(remainingDialogueTime(job, 15, Number.NaN)).toBe("Estimating…");
  });
});
