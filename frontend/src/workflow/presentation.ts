import type { TFunction } from "i18next";
import type { LibraryExport } from "../api/contracts";

export async function decodeImage(url: string) {
  if (!url || typeof Image === "undefined") return;
  const image = new Image();
  image.src = url;
  if (typeof image.decode === "function") await image.decode().catch(() => undefined);
}

export function monogram(title: string) {
  return title.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
}

export function message(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : "";
  if (/model.+not installed/i.test(raw)) return "errors.aiUnavailable";
  if (/Wait for this book's processing to finish/i.test(raw)) return "errors.bookProcessingActive";
  if (/Could not remove this book's working files/i.test(raw)) return "errors.deleteWorkingData";
  if (/No voice auditions could be created/i.test(raw)) return "No voice auditions could be created. Try again; your accepted choices are unchanged.";
  if (/API \d+|llama-server|\bQwen\b|\bJSON\b|characterId|render[- ]plan|superseded inputs/i.test(raw)) return "Something went wrong while completing this step. Try again; your accepted work is unchanged.";
  return raw || "Something went wrong. Try again; your accepted work is unchanged.";
}

const editionErrorKeys = new Set([
  "errors.aiUnavailable",
  "errors.bookProcessingActive",
  "errors.deleteWorkingData",
]);

export function localizeErrorMessage(value: string, t: TFunction) {
  return editionErrorKeys.has(value)
    ? t(value, { ns: "edition" })
    : t(value, { defaultValue: value });
}

export function localizeProcessMessage(value: string, t: TFunction) {
  if (value === "Preparing the remote speaker check") {
    return t("dialogue.preparingSpeakerCheck", { ns: "edition" });
  }
  const direct = t(value, { defaultValue: value });
  if (direct !== value) return direct;
  const patterns: Array<[RegExp, string, string[]]> = [
    [/^Extracted (\d+) pages$/, "Extracted {{count}} pages", ["count"]],
    [/^Extracted page (\d+) of (\d+)$/, "Extracted page {{page}} of {{count}}", ["page", "count"]],
    [/^Auditioning (.+) \((\d+) of (\d+)\)$/, "Auditioning {{name}} ({{current}} of {{count}})", ["name", "current", "count"]],
    [/^Generated voice (\d+) of (\d+): (.+)$/, "Generated voice {{current}} of {{count}}: {{name}}", ["current", "count", "name"]],
    [/^Regenerating the (.+) audition$/, "Regenerating the {{name}} audition", ["name"]],
    [/^Generating (\d+) required voice auditions$/, "Generating {{count}} required voice auditions", ["count"]],
    [/^Making chapter audio from (\d+) passages$/, "Making chapter audio from {{count}} passages", ["count"]],
    [/^Reviewing (\d+) character labels with AI$/, "Reviewing {{count}} character labels with AI", ["count"]],
    [/^Preparing (\d+) voice profiles with AI$/, "Preparing {{count}} voice profiles with AI", ["count"]],
    [/^Checking speaker assignments with (.+)$/, "Checking speaker assignments with {{model}}", ["model"]],
  ];
  for (const [pattern, key, names] of patterns) {
    const match = value.match(pattern);
    if (match) return t(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return value;
}

export function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatLibraryDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

export function formatLibraryChapters(item: LibraryExport, t: TFunction) {
  const positions = [...(item.chapterPositions ?? [])].sort((left, right) => left - right);
  if (!item.partial) return item.chapterCount === 1 ? t("1 chapter") : t("{{count}} chapters", { count: item.chapterCount });
  if (!positions.length) return t(item.chapterCount === 1 ? "Selected chapter" : "Selected chapters");
  const ranges: Array<[number, number]> = [];
  for (const position of positions) {
    const current = ranges.at(-1);
    if (current && position === current[1] + 1) current[1] = position;
    else ranges.push([position, position]);
  }
  if (ranges.length > 3) return t("{{count}} selected chapters", { count: item.chapterCount });
  const labels = ranges.map(([start, end]) => start === end ? `${start}` : `${start}–${end}`);
  return t(positions.length === 1 ? "Chapter {{labels}}" : "Chapters {{labels}}", { labels: labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} & ${labels.at(-1)}` });
}
