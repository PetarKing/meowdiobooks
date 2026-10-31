import type {
  DialogueArtifact,
  DialogueAttributionTarget,
  DialogueSettings,
  DialogueStrategy,
  RawDialogueCandidate,
} from "../api/contracts";

export function dialogueSettings(dialogue: DialogueArtifact, strategy: DialogueStrategy, attributionTargets = dialogue.attributionTargets ?? ["unlabelled-candidates"]): DialogueSettings {
  return { strategy, attributionTargets, openSpeakerPatterns: dialogue.openSpeakerPatterns, conflictResolutions: dialogue.conflictResolutions ?? [], structuralResolutions: dialogue.structuralResolutions ?? [], regexes: dialogue.regexes.map(({ id, label, pattern, flags, priority, enabled, builtIn }) => ({ id, label, pattern, flags, priority, enabled, builtIn })) };
}

export function toggleTarget(current: DialogueAttributionTarget[], target: DialogueAttributionTarget) { return current.includes(target) ? current.filter((row) => row !== target) : [...current, target]; }
export function availableAttributionTargets(dialogue: DialogueArtifact, targets: DialogueAttributionTarget[]) { return targets.filter((target) => target === "open-speakers" ? dialogue.summary.openSpeakerTurns > 0 : dialogue.summary.unlabeledCandidates > 0); }
export function selectedAttributionCount(dialogue: DialogueArtifact, targets: DialogueAttributionTarget[]) { return (targets.includes("open-speakers") ? dialogue.summary.openSpeakerTurns : 0) + (targets.includes("unlabelled-candidates") ? dialogue.summary.unlabeledCandidates : 0); }
export function dialogueRegexClaimCount(dialogue: DialogueArtifact) { return dialogue.summary.regexClaims ?? new Set((dialogue.conflicts ?? []).flatMap((conflict) => conflict.claims.map((claim) => claim.matchId))).size; }

export function dialogueOutcomeCounts(dialogue: DialogueArtifact) {
  const assignments = dialogue.readerAssignments ?? [];
  if (assignments.length) {
    const known = assignments.reduce((total, row) => total + (row.label === "Narrator" ? 0 : row.known), 0);
    const ai = assignments.reduce((total, row) => total + (row.label === "Narrator" ? 0 : row.ai), 0);
    const user = assignments.reduce((total, row) => total + (row.label === "Narrator" ? 0 : row.user), 0);
    const narrator = assignments.find((row) => row.label === "Narrator")?.total ?? 0;
    return { total: known + ai + user + narrator, known, ai, user, narrator };
  }
  const known = dialogue.summary.explicitTurns ?? 0;
  const ai = dialogue.summary.aiAttributed ?? 0;
  const user = dialogue.summary.userCorrected ?? 0;
  const narrator = dialogue.summary.unresolved ?? 0;
  return { total: known + ai + user + narrator, known, ai, user, narrator };
}

export function candidateDialogue(candidate: RawDialogueCandidate, preview: DialogueArtifact, strategy: DialogueStrategy): DialogueArtifact {
  const summary = candidate.resultSummary ?? candidate.summary ?? {};
  const spans = candidate.spans ?? [];
  const windows = candidate.aiWindows ?? [];
  const matches = candidate.matches ?? [];
  const blocks = candidate.blocks ?? [];
  const sharedChecks = candidate.attributionChecks ?? [];
  const legacyRemoteChecks = candidate.remoteAttributionChecks ?? [];
  const checks = sharedChecks.length ? sharedChecks : legacyRemoteChecks;
  const spansById = new Map(spans.map((row) => [String(row.id ?? ""), row]));
  const matchesBySpanId = new Map(matches.map((row) => [String(row.spanId ?? ""), row]));
  const blocksById = new Map(blocks.map((row) => [String(row.id ?? ""), row]));
  const checksBySpanId = new Map(checks.map((row) => [String(row.spanId ?? ""), row]));
  const readerAssignments = dialogueReaderAssignments(spans);
  const speakerOptions = [...new Set([...spans.flatMap((row) => {
    const label = row.resolvedSpeakerLabel ?? row.sourceSpeakerLabel;
    return label == null || String(label).trim() === "" || String(label).trim() === "?" ? [] : [String(label).trim()];
  }), ...checks.flatMap((row) => Array.isArray(row.suggestedSpeakers) ? row.suggestedSpeakers.map((label) => String(label).trim()).filter(Boolean) : [])])].sort((left, right) => left.localeCompare(right));
  const examples = windows.flatMap((window) => {
    const ownerId = Array.isArray(window.ownerIds) ? String(window.ownerIds[0] ?? "") : "";
    if (!ownerId) return [];
    const dossier = Array.isArray(window.dossiers) ? window.dossiers[0] as Record<string, unknown> | undefined : undefined;
    const match = matchesBySpanId.get(ownerId);
    const outcome = spansById.get(ownerId);
    const block = match ? blocksById.get(String(match.blockId ?? "")) : undefined;
    const evidence = dialogueEvidence(dossier, match, block);
    const reviewEvidence = dialogueReviewEvidence(spans, ownerId, dossier, evidence);
    const attributionCheck = checksBySpanId.get(ownerId);
    const suggestedSpeakers = Array.isArray(attributionCheck?.suggestedSpeakers)
      ? [...new Set(attributionCheck.suggestedSpeakers.map((label) => String(label).trim()).filter(Boolean))]
      : [];
    const rejected = outcome == null;
    return [{
      spanId: ownerId,
      page: Number(dossier?.page ?? match?.page ?? outcome?.page ?? 0),
      source: evidence.target,
      spokenText: rejected ? evidence.target : String(outcome.text ?? evidence.target),
      speakerLabel: rejected ? null : outcome.resolvedSpeakerLabel == null ? null : String(outcome.resolvedSpeakerLabel),
      speakerStatus: (rejected ? "unlabelled" : String(outcome.speakerStatus ?? "unresolved")) as DialogueArtifact["examples"][number]["speakerStatus"],
      origin: rejected ? "qwen:not-vocalisation" : String(outcome.origin ?? "qwen:targeted-speaker-v2"),
      contextBefore: reviewEvidence.before,
      contextAfter: reviewEvidence.after,
      expandedContextBefore: reviewEvidence.expandedBefore,
      expandedContextAfter: reviewEvidence.expandedAfter,
      suggestedSpeakers,
    }];
  });
  return { ...preview, revision: candidate.revision, strategy, speakerOptions, readerAssignments, summary: { totalTurns: Number(summary.totalTurns ?? spans.length), regexClaims: Number(summary.regexClaims ?? preview.summary.regexClaims ?? 0), explicitTurns: Number(summary.explicitTurns ?? preview.summary.explicitTurns), openSpeakerTurns: Number(summary.openSpeakerTurns ?? preview.summary.openSpeakerTurns), unlabeledCandidates: Number(summary.unlabelledCandidates ?? preview.summary.unlabeledCandidates), conflicts: Number(summary.conflicts ?? 0), aiAttributed: Number(summary.aiAttributed ?? 0), aiSuggestedForReview: Number(summary.aiSuggestedForReview ?? examples.filter((row) => row.suggestedSpeakers.length > 0).length), unresolved: Number(summary.unresolved ?? spans.filter((row) => row.speakerStatus === "unresolved").length) }, examples };
}

export function dialogueReaderAssignments(spans: Array<Record<string, unknown>>) {
  const counts = new Map<string, { label: string; total: number; known: number; ai: number; user: number }>();
  const logicalSpans = new Map<string, Record<string, unknown>>();
  spans.forEach((span, index) => {
    if (String(span.renderRole ?? "") !== "dialogue") return;
    logicalSpans.set(String(span.turnGroupId ?? span.id ?? index), span);
  });
  logicalSpans.forEach((span) => {
    const rawLabel = String(span.resolvedSpeakerLabel ?? span.sourceSpeakerLabel ?? "").trim();
    const label = rawLabel && !/^\?+$/.test(rawLabel) ? rawLabel : "Narrator";
    const status = String(span.speakerStatus ?? "");
    const current = counts.get(label) ?? { label, total: 0, known: 0, ai: 0, user: 0 };
    current.total += 1;
    if (status === "ai") current.ai += 1;
    else if (status === "user") current.user += 1;
    else if (label !== "Narrator") current.known += 1;
    counts.set(label, current);
  });
  return [...counts.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function dialogueEvidence(dossier?: Record<string, unknown>, match?: Record<string, unknown>, block?: Record<string, unknown>) {
  const blockText = String(block?.text ?? "");
  const start = Number(match?.sourceStart ?? 0);
  const end = Number(match?.sourceEnd ?? start);
  const target = clipEvidence(String(match?.source ?? match?.text ?? ""), 1_200, "both");
  const blockEvidence = {
    before: clipEvidence(blockText.slice(0, start), dialogueReviewContext.defaultCharacters, "start"),
    target,
    after: clipEvidence(blockText.slice(end), dialogueReviewContext.defaultCharacters, "end"),
    expandedBefore: clipEvidence(blockText.slice(0, start), dialogueReviewContext.maximumCharacters, "start"),
    expandedAfter: clipEvidence(blockText.slice(end), dialogueReviewContext.maximumCharacters, "end"),
  };
  if (!dossier) return blockEvidence;
  return {
    before: String(dossier.before ?? "") || blockEvidence.before,
    target: String(dossier.target ?? "") || blockEvidence.target,
    after: String(dossier.after ?? "") || blockEvidence.after,
    expandedBefore: blockEvidence.expandedBefore || String(dossier.before ?? ""),
    expandedAfter: blockEvidence.expandedAfter || String(dossier.after ?? ""),
  };
}

const dialogueReviewContext = { defaultUnits: 3, defaultCharacters: 420, maximumUnits: 8, maximumCharacters: 1_800 } as const;

function dialogueReviewEvidence(spans: Array<Record<string, unknown>>, ownerId: string, dossier: Record<string, unknown> | undefined, fallback: { before: string; target: string; after: string; expandedBefore?: string; expandedAfter?: string }) {
  const targetIds = new Set(Array.isArray(dossier?.spanIds) && dossier.spanIds.length ? dossier.spanIds.map(String) : [ownerId]);
  const targetPositions = spans.flatMap((span, index) => targetIds.has(String(span.id ?? "")) ? [index] : []);
  if (!targetPositions.length) return { before: fallback.before, after: fallback.after, expandedBefore: fallback.expandedBefore ?? fallback.before, expandedAfter: fallback.expandedAfter ?? fallback.after };
  const first = Math.min(...targetPositions);
  const last = Math.max(...targetPositions);
  const before = focusedDialogueReviewContext(spans, first - 1, -1, dialogueReviewContext.defaultUnits, dialogueReviewContext.defaultCharacters);
  const after = focusedDialogueReviewContext(spans, last + 1, 1, dialogueReviewContext.defaultUnits, dialogueReviewContext.defaultCharacters);
  const expandedBefore = focusedDialogueReviewContext(spans, first - 1, -1, dialogueReviewContext.maximumUnits, dialogueReviewContext.maximumCharacters);
  const expandedAfter = focusedDialogueReviewContext(spans, last + 1, 1, dialogueReviewContext.maximumUnits, dialogueReviewContext.maximumCharacters);
  return { before: before || fallback.before, after: after || fallback.after, expandedBefore: expandedBefore || before || fallback.before, expandedAfter: expandedAfter || after || fallback.after };
}

function focusedDialogueReviewContext(spans: Array<Record<string, unknown>>, start: number, direction: -1 | 1, maximumUnits: number, maximumCharacters: number) {
  const units: string[] = [];
  for (let index = start; index >= 0 && index < spans.length && units.length < maximumUnits; index += direction) {
    const source = formatEvidenceText(String(spans[index].source ?? spans[index].text ?? ""));
    if (!source) continue;
    if (direction < 0) units.unshift(source);
    else units.push(source);
  }
  return clipEvidence(units.join("\n\n"), maximumCharacters, direction < 0 ? "start" : "end");
}

function clipEvidence(value: string, limit: number, side: "start" | "end" | "both") {
  const clean = formatEvidenceText(value);
  if (clean.length <= limit) return clean;
  if (side === "start") return `…${clean.slice(-limit)}`;
  if (side === "end") return `${clean.slice(0, limit)}…`;
  const half = Math.floor((limit - 3) / 2);
  return `${clean.slice(0, half)} … ${clean.slice(-half)}`;
}

function formatEvidenceText(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
