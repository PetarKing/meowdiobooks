import type { ReviewCapability, ReviewWarning, WarningOccurrence } from "../api/contracts";
import type { TFunction } from "i18next";

function reviewText(t: TFunction | undefined, key: string, values: Record<string, string | number> = {}) {
  if (t) return String(t(key, values));
  return key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ""));
}

export function normalizeCandidateWarnings(candidate: { warnings?: unknown }): ReviewWarning[] {
  if (!Array.isArray(candidate.warnings)) return [];
  const aliases: Record<string, string> = { "missing-content": "empty-page", "extraction-artifact": "suspicious-extraction", "ocr-artifact": "suspicious-extraction", "layout-order": "reading-order", "peripheral-matter": "front-back-matter" };
  return (candidate.warnings as Array<Record<string, unknown>>).map((row) => { const rawKind = String(row.kind ?? "review-warning"); const readerState = String(row.readerState ?? ""); return { decisionScope: row.decisionScope as ReviewWarning["decisionScope"], id: String(row.id ?? row.kind), kind: aliases[rawKind] ?? rawKind, detail: String(row.detail ?? "Inspect this anchored issue."), severity: (["notice", "warning", "blocking"].includes(String(row.severity)) ? String(row.severity) : "warning") as ReviewWarning["severity"], readerState: (["narrator", "assigned-speaker", "mixed"].includes(readerState) ? readerState : undefined) as ReviewWarning["readerState"], availableActions: Array.isArray(row.availableActions) ? row.availableActions.map(String).filter((action) => action !== "defer") as ReviewCapability[] : ["keep"], occurrences: Array.isArray(row.occurrences) ? (row.occurrences as Array<Record<string, unknown>>).map((occurrence) => ({ readerState: occurrence.readerState as WarningOccurrence["readerState"], proposalStatus: occurrence.proposalStatus as WarningOccurrence["proposalStatus"], cleanupReason: occurrence.cleanupReason == null ? undefined : String(occurrence.cleanupReason), id: String(occurrence.id), source: String(occurrence.source ?? occurrence.text ?? ""), text: String(occurrence.text ?? occurrence.source ?? ""), page: Number(occurrence.page ?? 0), contextBefore: occurrence.contextBefore == null ? undefined : String(occurrence.contextBefore), contextAfter: occurrence.contextAfter == null ? undefined : String(occurrence.contextAfter), replacement: typeof occurrence.replacement === "string" ? occurrence.replacement : undefined, availableActions: Array.isArray(occurrence.availableActions) ? occurrence.availableActions.map(String) as ReviewCapability[] : undefined, reason: occurrence.reason == null ? undefined : String(occurrence.reason) })) : [] }; });
}

export function reviewActionTitle(action: ReviewCapability, warning: ReviewWarning) {
  const { kind, readerState } = warning;
  if (kind === "ai-cleanup" && action === "keep") return "Keep original text";
  if (kind === "ai-cleanup" && action === "repair") return "Apply correction";
  if (kind === "empty-page" && action === "keep") return "Confirm this page is intentionally empty";
  if (kind === "empty-page" && action === "rerun-extraction") return "Try extraction again";
  if (kind === "reading-order" && action === "keep") return "Accept this reading order";
  if (action === "keep" && readerState === "narrator") return "Keep with narrator";
  return ({ repair: "Apply proposal", keep: "Keep as is", exclude: "Leave out", narrate: "Use narrator instead", "rerun-extraction": "Try extraction again", "rerun-dialogue": "Rebuild speaker assignments" } as Record<ReviewCapability, string>)[action];
}

export function reviewDecisionActions(warning: ReviewWarning): ReviewCapability[] {
  const order: ReviewCapability[] = warning.kind === "ai-cleanup" || warning.availableActions.includes("repair")
    ? ["repair", "keep", "exclude", "narrate", "rerun-extraction", "rerun-dialogue"]
    : ["keep", "repair", "exclude", "narrate", "rerun-extraction", "rerun-dialogue"];
  return [...warning.availableActions].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export function reviewConsequence(action: ReviewCapability, warning: ReviewWarning, t?: TFunction) {
  const count = warning.occurrences.length;
  const { kind, readerState } = warning;
  const subject = count === 1
    ? reviewText(t, "This highlighted text")
    : reviewText(t, "All {{count}} highlighted sections", { count });
  if (kind === "ai-cleanup" && action === "keep") return reviewText(t, "Keep the original text for this suggestion.");
  if (kind === "empty-page" && action === "keep") return reviewText(t, "Confirm that all {{count}} pages are intentionally empty; nothing is removed.", { count });
  if (kind === "reading-order" && action === "keep") return reviewText(t, "Accept the extracted order for all {{count}} highlighted locations.", { count });
  if (action === "keep" && readerState === "narrator") return reviewText(t, "{{subject}} will be read by the narrator.", { subject });
  return ({
    repair: reviewText(t, "Apply this exact correction to the audiobook transcript. Your source stays unchanged."),
    keep: reviewText(t, readerState === "mixed" || count > 1 ? "{{subject}} will keep their current readers." : "{{subject}} will keep its current reader.", { subject }),
    exclude: reviewText(t, "{{subject}} will not be spoken. Your source stays unchanged.", { subject }),
    narrate: reviewText(t, "{{subject}} will be read by the narrator instead.", { subject }),
    "rerun-extraction": reviewText(t, "Read the source again."),
    "rerun-dialogue": reviewText(t, "Rebuild who reads the detected dialogue."),
  } as Record<ReviewCapability, string>)[action];
}

export function reviewQuestion(kind: string) {
  if (kind === "ai-cleanup") return "Apply this proposed correction?";
  if (kind === "empty-page") return "Is this page intentionally empty?";
  if (kind === "suspicious-extraction") return "Does this text match the source?";
  if (kind === "reading-order") return "Is this in the right reading order?";
  if (kind === "repeated-matter") return "Should listeners hear this repeated text?";
  if (kind === "page-number") return "Should listeners hear this page number?";
  if (kind === "stage-direction") return "Should these script directions be spoken?";
  if (kind === "web-address") return "Should listeners hear this web address?";
  if (kind === "footnote") return "Should listeners hear these footnotes?";
  return "Should listeners hear this text?";
}

export function reviewGuidance(warning: ReviewWarning) {
  const guidance: Partial<Record<string, string>> = {
    "ai-cleanup": "OpenAI Decisions flags possible cleanup errors and Luna proposes corrections. Check each change against the source before applying it.",
    "empty-page": "No text was extracted from this page. Confirm it when the source page is intentionally blank or visual-only; try another extraction when visible words are missing.",
    "suspicious-extraction": "Check whether the highlighted words match the source. Keep correct text, leave out debris, or try extraction again.",
    "reading-order": "The extractor reported a possible column or reading-order problem. Accept it only when the highlighted source follows the order a listener should hear.",
    "repeated-matter": "This text repeats near page edges and may be a header or footer. Remove running matter; keep repeated prose that belongs to the story.",
    "page-number": "The highlighted value looks like a printed page number. Remove it unless it is meaningful story text.",
    "stage-direction": "Delivery and sound cues usually stay unspoken. Choose the narrator for descriptive action, or keep text that is intended as dialogue.",
    "web-address": "The highlighted text is a web address. Leave it out unless listeners need to hear it.",
    footnote: "Choose whether listeners should hear these notes.",
    "front-back-matter": "Choose whether listeners should hear this front, back, or editorial text.",
  };
  return guidance[warning.kind] ?? warning.detail;
}

export function reviewWarningLabel(kind: string) {
  return ({ "ai-cleanup": "AI cleanup", "stage-direction": "Script direction", "empty-page": "Empty extracted page", "suspicious-extraction": "Suspicious extracted text", "reading-order": "Reading order", "repeated-matter": "Repeated page matter", "page-number": "Page number", "web-address": "Web address", footnote: "Footnote", "front-back-matter": "Front or back matter" } as Record<string, string>)[kind] ?? kind.replaceAll("-", " ");
}

export function reviewUsesOccurrenceDecisions(warning: ReviewWarning) {
  return warning.decisionScope === "occurrence" || warning.kind === "ai-cleanup";
}

// Corrections may augment an existing deterministic warning without duplicating it.
export function reviewOccurrenceActions(warning: ReviewWarning, occurrence: WarningOccurrence): ReviewCapability[] {
  if (!reviewUsesOccurrenceDecisions(warning)) return reviewDecisionActions(warning);
  const available = occurrence.availableActions ?? warning.availableActions;
  return reviewDecisionActions({ ...warning, availableActions: available.filter((action) =>
    action !== "repair" || typeof occurrence.replacement === "string",
  ) });
}

export function reviewWarningResolved(warning: ReviewWarning, decisions: Record<string, ReviewCapability>) {
  return reviewUsesOccurrenceDecisions(warning)
    ? warning.occurrences.every((row) => reviewOccurrenceActions(warning, row).includes(decisions[row.id]))
    : warning.availableActions.includes(decisions[warning.id]);
}

export function reviewProposalDecisions(warning: ReviewWarning, decisions: Record<string, ReviewCapability>) {
  const next = { ...decisions };
  for (const row of warning.occurrences) {
    if (reviewUsesOccurrenceDecisions(warning) && reviewOccurrenceActions(warning, row).includes("repair")) next[row.id] = "repair";
  }
  return next;
}
