import type { Job, WizardSnapshot } from "../api/contracts";
import appI18n from "../i18n";

export function hasGenerationAction(snapshot?: WizardSnapshot): boolean {
  if (!snapshot?.recordingScript) return false;
  const unavailable = new Set(snapshot.recordingScript.summary.emptyChapterIds);
  return snapshot.chapters.some((chapter) => !unavailable.has(chapter.id))
    || snapshot.generatedChapters.some((chapter) => chapter.current);
}

export const longChapterSplitSeconds = 2 * 60 * 60;
export const targetChapterPartSeconds = 30 * 60;
// One comparable concurrent run can consume half of the shared synthesis capacity.
const generationHistoryHeadroom = 2;

export interface GenerationEstimatePolicy {
  fallbackLowerMultiplier: number;
  fallbackUpperMultiplier: number;
}

export const publicGenerationEstimatePolicy: GenerationEstimatePolicy = {
  fallbackLowerMultiplier: 0.5,
  fallbackUpperMultiplier: 2,
};

export interface GenerationRun {
  chapterIds: string[];
  estimatedAudioSeconds: number;
  historicalMultiplier?: number;
  startedAtMs: number;
}

export interface GenerationSample {
  finishedAt: number;
  multiplier: number;
}

export function chapterDuration(seconds?: number, estimated = true) {
  if (!seconds) return appI18n.t("Estimate pending");
  const roundedSeconds = Math.max(1, Math.round(seconds));
  if (roundedSeconds < 60) return appI18n.t(estimated ? "≈ {{count}} sec" : "{{count}} sec", { count: roundedSeconds });
  const minutes = Math.max(1, Math.round(roundedSeconds / 60));
  if (minutes < 60) return appI18n.t(estimated ? "≈ {{count}} min" : "{{count}} min", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder) return appI18n.t(estimated ? "≈ {{hours}} hr {{minutes}} min" : "{{hours}} hr {{minutes}} min", { hours, minutes: remainder });
  return appI18n.t(estimated ? "≈ {{count}} hr" : "{{count}} hr", { count: hours });
}

export function generationDuration(
  seconds?: number,
  historicalMultiplier?: number,
  policy: GenerationEstimatePolicy = publicGenerationEstimatePolicy,
) {
  if (!seconds) return "Estimate pending";
  const lowerMultiplier = historicalMultiplier ?? policy.fallbackLowerMultiplier;
  const upperMultiplier = historicalMultiplier
    ? historicalMultiplier * generationHistoryHeadroom
    : policy.fallbackUpperMultiplier;
  const lowerMinutes = Math.max(1, Math.ceil(seconds * lowerMultiplier / 60));
  const upperMinutes = Math.max(lowerMinutes, Math.ceil(seconds * upperMultiplier / 60));
  const display = (minutes: number) => minutes < 60
    ? appI18n.t("{{count}} min", { count: minutes })
    : minutes % 60
      ? appI18n.t("{{hours}} hr {{minutes}} min", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
      : appI18n.t("{{count}} hr", { count: Math.floor(minutes / 60) });
  return lowerMinutes === upperMinutes
    ? appI18n.t("≈ {{duration}}", { duration: display(lowerMinutes) })
    : appI18n.t("≈ {{lower}}–{{upper}}", { lower: display(lowerMinutes), upper: display(upperMinutes) });
}

export function generationSample(job: Job): GenerationSample | undefined {
  if (job.kind !== "v2:generate" || job.status !== "succeeded" || !job.started_at || !job.finished_at) return undefined;
  const startedAt = Date.parse(job.started_at);
  const finishedAt = Date.parse(job.finished_at);
  const chapters = Array.isArray(job.result?.chapters) ? job.result.chapters as Array<Record<string, unknown>> : [];
  const audioSeconds = chapters.reduce((total, chapter) => total + Number(chapter.audioSeconds ?? 0), 0);
  const elapsedSeconds = (finishedAt - startedAt) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(audioSeconds) || audioSeconds <= 0) return undefined;
  return { finishedAt, multiplier: elapsedSeconds / audioSeconds };
}

export function recentGenerationSamples(jobs: Job[]) {
  return jobs
    .map(generationSample)
    .filter((sample): sample is GenerationSample => Boolean(sample))
    .sort((left, right) => right.finishedAt - left.finishedAt)
    .slice(0, 3);
}

export function averageGenerationMultiplier(samples: GenerationSample[]) {
  if (!samples.length) return undefined;
  return samples.reduce((total, sample) => total + sample.multiplier, 0) / samples.length;
}

export function readyChapterCount(run: GenerationRun | undefined, job: Job | undefined, progress: number) {
  if (!run) return 0;
  if (job?.status === "queued") return 0;
  if (progress >= 100) return run.chapterIds.length;
  // Publishing begins only after every requested chapter has finished rendering.
  // These are recorded chapters, not a claim that publication has succeeded.
  if (job?.status === "running" && job.message === "Publishing saved chapter audio") return run.chapterIds.length;
  // Parallel renderers report completed chapters in aggregate, without a current
  // chapter ID. Only trust counts for this exact requested set size.
  const aggregate = /^Rendering chapters: (\d+) of (\d+) complete$/.exec(job?.message ?? "");
  if (aggregate) {
    const completed = Number(aggregate[1]);
    const total = Number(aggregate[2]);
    return Number.isSafeInteger(completed) && total === run.chapterIds.length && completed <= total
      ? completed
      : 0;
  }
  // Sequential renderers prefix their status with the current chapter ID.
  return Math.max(0, run.chapterIds.findIndex((id) => job?.message?.startsWith(`${id}:`)));
}

export function remainingGenerationTime(
  run: GenerationRun | undefined,
  job: Job | undefined,
  progress: number,
  policy: GenerationEstimatePolicy = publicGenerationEstimatePolicy,
) {
  if (job?.status === "queued") return "Waiting to start";
  if (job?.status === "running" && /^Waiting for audio capacity \(queue position \d+\)$/.test(job.message ?? "")) {
    return "Waiting for audio capacity";
  }
  if (!run) return "Estimating…";
  const parsedStartedAt = job?.started_at ? Date.parse(job.started_at) : Number.NaN;
  const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : run.startedAtMs;
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  if (progress >= 8 && progress < 100 && elapsedSeconds >= 30) {
    return chapterDuration(elapsedSeconds * (100 - progress) / progress);
  }
  if (progress >= 100) return "Almost done";
  return generationDuration(run.estimatedAudioSeconds, run.historicalMultiplier, policy);
}
