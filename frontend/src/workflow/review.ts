import type { ReviewCapability, ReviewWarning, WarningOccurrence } from "../api/contracts";
import type { TFunction } from "i18next";
import { userFacingDetail } from "./presentation";

function reviewText(t: TFunction | undefined, key: string, values: Record<string, string | number> = {}) {
  if (t) return String(t(key, values));
  return key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ""));
}

export function normalizeCandidateWarnings(candidate: { warnings?: unknown }): ReviewWarning[] {
  if (!Array.isArray(candidate.warnings)) return [];
  const aliases: Record<string, string> = { "missing-content": "empty-page", "extraction-artifact": "suspicious-extraction", "ocr-artifact": "suspicious-extraction", "layout-order": "reading-order", "peripheral-matter": "front-back-matter" };
  const warnings: ReviewWarning[] = (candidate.warnings as Array<Record<string, unknown>>).map((row) => { const rawKind = String(row.kind ?? "review-warning"); const readerState = String(row.readerState ?? ""); return { decisionScope: row.decisionScope as ReviewWarning["decisionScope"], id: String(row.id ?? row.kind), kind: aliases[rawKind] ?? rawKind, detail: String(row.detail ?? "Compare the highlighted text with your source document."), severity: (["notice", "warning", "blocking"].includes(String(row.severity)) ? String(row.severity) : "warning") as ReviewWarning["severity"], readerState: (["narrator", "assigned-speaker", "mixed"].includes(readerState) ? readerState : undefined) as ReviewWarning["readerState"], availableActions: Array.isArray(row.availableActions) ? row.availableActions.map(String).filter((action) => action !== "defer") as ReviewCapability[] : ["keep"], occurrences: Array.isArray(row.occurrences) ? (row.occurrences as Array<Record<string, unknown>>).map((occurrence) => ({ patternGroupId: typeof occurrence.patternGroupId === "string" ? occurrence.patternGroupId : undefined, patternVerification: occurrence.patternVerification === "verified" ? "verified" : undefined, contextLayout: occurrence.contextLayout === "continuous" ? "continuous" : undefined, recommendedAction: occurrence.recommendedAction === "exclude" ? "exclude" : undefined, cueVerification: occurrence.cueVerification === "verified" ? "verified" : undefined, readerState: occurrence.readerState as WarningOccurrence["readerState"], proposalStatus: occurrence.proposalStatus as WarningOccurrence["proposalStatus"], cleanupReason: occurrence.cleanupReason == null ? undefined : String(occurrence.cleanupReason), id: String(occurrence.id), source: String(occurrence.source ?? occurrence.text ?? ""), text: String(occurrence.text ?? occurrence.source ?? ""), page: Number(occurrence.page ?? 0), contextBefore: occurrence.contextBefore == null ? undefined : String(occurrence.contextBefore), contextAfter: occurrence.contextAfter == null ? undefined : String(occurrence.contextAfter), replacement: typeof occurrence.replacement === "string" ? occurrence.replacement : undefined, availableActions: Array.isArray(occurrence.availableActions) ? occurrence.availableActions.map(String) as ReviewCapability[] : undefined, reason: occurrence.reason == null ? undefined : String(occurrence.reason) })) : [] }; });
  // Older candidates attached corrections to deterministic categories. Preserve
  // occurrence IDs and capabilities for preview and acceptance of saved revisions.
  const aiWarnings = warnings.filter((warning) => warning.kind === "ai-cleanup");
  const aiRows: WarningOccurrence[] = [];
  const sourceWarnings: ReviewWarning[] = [];
  for (const warning of warnings) {
    const moved = warning.occurrences.filter((row) => warning.kind === "ai-cleanup" ||
      (typeof row.replacement === "string" && (row.availableActions ?? warning.availableActions).includes("repair")));
    aiRows.push(...moved.map((row) => ({ ...row, availableActions: row.availableActions ?? warning.availableActions })));
    if (warning.kind === "ai-cleanup") continue;
    const movedIds = new Set(moved.map((row) => row.id));
    const remaining = warning.occurrences.filter((row) => !movedIds.has(row.id));
    if (remaining.length) sourceWarnings.push({ ...warning, occurrences: remaining, ...(moved.length ? { decisionScope: "occurrence" as const } : {}) });
  }
  if (!aiRows.length) return sourceWarnings;
  const uniqueRows = [...new Map(aiRows.map((row) => [row.id, row])).values()];
  const aiIds = new Set(uniqueRows.map((row) => row.id));
  const ordinary: WarningOccurrence[] = [];
  const families = new Map<string, WarningOccurrence[]>();
  for (const row of uniqueRows) {
    if (row.patternVerification === "verified" && row.patternGroupId?.trim() && row.replacement === "" &&
        row.proposalStatus === "proposed" && ["keep", "exclude"].every((action) => row.availableActions?.includes(action as ReviewCapability))) {
      const members = families.get(row.patternGroupId) ?? [];
      members.push(row);
      families.set(row.patternGroupId, members);
    } else ordinary.push(row);
  }
  const result = sourceWarnings.map((warning) => ({ ...warning, occurrences: warning.occurrences.filter((row) => !aiIds.has(row.id)) })).filter((warning) => warning.occurrences.length);
  for (const [patternGroupId, occurrences] of families) {
    result.push({ id: `review:pattern:${patternGroupId}`, kind: "repeated-page-text", decisionScope: "occurrence",
      patternGroupId, patternVerification: "verified", severity: "warning",
      detail: "Repeated page text was checked in context.", availableActions: ["keep", "exclude"], occurrences });
  }
  if (ordinary.length) result.push({
    id: aiWarnings.find((warning) => !warning.occurrences.some((row) => row.patternGroupId))?.id ?? "ai-cleanup",
    kind: "ai-cleanup", decisionScope: "occurrence", severity: "warning",
    detail: "Review AI suggestions against the source.",
    availableActions: [...new Set(ordinary.flatMap((row) => row.availableActions ?? []))],
    occurrences: ordinary,
  });
  return result;
}

export function reviewActionTitle(action: ReviewCapability, warning: ReviewWarning) {
  const { kind, readerState } = warning;
  if (reviewIsPatternGroup(warning)) return action === "keep" ? "Keep this occurrence" : "Omit this occurrence";
  if ((kind === "ai-cleanup" || reviewIsVerifiedScriptGroup(warning)) && action === "keep") return "Keep";
  if ((kind === "ai-cleanup" || reviewIsVerifiedScriptGroup(warning)) && action === "exclude") return "Leave";
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
  return warning.availableActions.filter((action) => action !== "rerun-extraction").sort((left, right) => order.indexOf(left) - order.indexOf(right));
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
  if (kind === "repeated-page-text") return "Should listeners hear this repeated text?";
  if (kind === "ai-cleanup") return "What should happen to this text?";
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
  if (reviewIsPatternGroup(warning)) return "Choose once for this repeated text. You can keep or omit individual occurrences as exceptions.";
  if (reviewIsVerifiedScriptGroup(warning)) return "AI checked these delivery cues in context. Suggested choices leave them unspoken. Uncertain text stays spoken and needs no decision.";
  const guidance: Partial<Record<string, string>> = {
    "ai-cleanup": "Check each suggested correction against the source document before applying it.",
    "empty-page": "No text was extracted from this page. Confirm it only when the source page is intentionally blank or visual-only.",
    "suspicious-extraction": "Check whether the highlighted words match the source. Keep correct text or leave out debris.",
    "reading-order": "The text may be in the wrong order. Keep it only if it follows the order a listener should hear.",
    "repeated-matter": "This text repeats near page edges and may be a header or footer. Remove running matter; keep repeated prose that belongs to the story.",
    "page-number": "The highlighted value looks like a printed page number. Remove it unless it is meaningful story text.",
    "stage-direction": "Delivery and sound cues usually stay unspoken. Choose the narrator for descriptive action, or keep text that is intended as dialogue.",
    "web-address": "The highlighted text is a web address. Leave it out unless listeners need to hear it.",
    footnote: "Choose whether listeners should hear these notes.",
    "front-back-matter": "Choose whether listeners should hear this front, back, or editorial text.",
  };
  return guidance[warning.kind] ?? userFacingDetail(warning.detail, "Compare the highlighted text with your source document.");
}

export function reviewWarningLabel(kind: string) {
  return ({ "repeated-page-text": "Repeated page text", "ai-cleanup": "AI suggestions", "stage-direction": "Script directions", "empty-page": "Empty extracted page", "suspicious-extraction": "Suspicious extracted text", "reading-order": "Reading order", "repeated-matter": "Repeated page matter", "page-number": "Page number", "web-address": "Web address", footnote: "Footnote", "front-back-matter": "Front or back matter" } as Record<string, string>)[kind] ?? "Text to review";
}

export function reviewUsesOccurrenceDecisions(warning: ReviewWarning) {
  return warning.decisionScope === "occurrence" || warning.kind === "ai-cleanup";
}

export function reviewIsVerifiedScriptGroup(warning: ReviewWarning) {
  return warning.kind === "stage-direction" && warning.decisionScope === "occurrence" &&
    warning.occurrences.length > 0 && warning.occurrences.every((row) =>
      row.cueVerification === "verified" && row.recommendedAction === "exclude");
}

export function reviewScriptCueDecisions(warning: ReviewWarning, decisions: Record<string, ReviewCapability>) {
  const next = { ...decisions };
  if (!reviewIsVerifiedScriptGroup(warning)) return next;
  for (const row of warning.occurrences) {
    if (next[row.id] === undefined && reviewOccurrenceActions(warning, row).includes("exclude")) next[row.id] = "exclude";
  }
  return next;
}

// Candidate normalization gathers corrections into the AI suggestions category.
export function reviewOccurrenceActions(warning: ReviewWarning, occurrence: WarningOccurrence): ReviewCapability[] {
  if (!reviewUsesOccurrenceDecisions(warning)) return reviewDecisionActions(warning);
  const available = occurrence.availableActions ?? warning.availableActions;
  if (reviewIsPatternGroup(warning)) return (["keep", "exclude", "repair"] as ReviewCapability[]).filter((action) => available.includes(action));
  if (reviewIsVerifiedScriptGroup(warning)) return (["keep", "exclude"] as ReviewCapability[]).filter((action) => available.includes(action));
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
    if (next[row.id] === undefined && reviewUsesOccurrenceDecisions(warning) && reviewOccurrenceActions(warning, row).includes("repair")) next[row.id] = "repair";
  }
  return next;
}


export function reviewIsPatternGroup(warning: ReviewWarning) {
  return warning.kind === "repeated-page-text" && warning.patternVerification === "verified" &&
    Boolean(warning.patternGroupId) && warning.occurrences.length > 0 && warning.occurrences.every((row) =>
      row.patternVerification === "verified" && row.patternGroupId === warning.patternGroupId &&
      row.proposalStatus === "proposed" && row.replacement === "" &&
      ["keep", "exclude"].every((action) => row.availableActions?.includes(action as ReviewCapability)));
}

export function reviewPatternDecisions(warning: ReviewWarning, decisions: Record<string, ReviewCapability>, action: "keep" | "exclude") {
  const next = { ...decisions };
  if (!reviewIsPatternGroup(warning)) return next;
  for (const row of warning.occurrences) {
    if (next[row.id] === undefined) next[row.id] = action;
  }
  return next;
}
