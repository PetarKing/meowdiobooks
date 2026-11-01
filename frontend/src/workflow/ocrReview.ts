import type { ReviewCandidate, ReviewCapability, ReviewWarning, WarningOccurrence } from '../api/contracts';
import { normalizeCandidateWarnings, reviewOccurrenceActions, reviewUsesOccurrenceDecisions } from './review';

const missingKinds = new Set(['empty-page', 'missing-image-text']);

/** Only unresolved physical pages in the two missing-text categories are bulk targets. */
export function remainingOcrPages(warnings: ReviewWarning[], decisions: Record<string, ReviewCapability>) {
  return [...new Set(warnings.filter((warning) => missingKinds.has(warning.kind)).flatMap((warning) =>
    warning.occurrences.filter((row) => !decisions[row.id])
      .map((row) => row.page).filter((page) => Number.isInteger(page) && page > 0)))].sort((a, b) => a - b);
}

function evidence(row: WarningOccurrence) {
  return JSON.stringify([row.id, row.page, row.source, row.text, row.blockId, row.sourceStart,
    row.sourceEnd, row.replacement, row.boundarySource, row.boundaryAnchors, row.hyphenChoices,
    row.readerState, row.availableActions]);
}

/** Retain only decisions whose complete target evidence survived the source change. */
export function carryOcrReviewDecisions(previous: ReviewCandidate | undefined, next: ReviewCandidate,
  decisions: Record<string, ReviewCapability>) {
  const recovered = new Set(next.ocrRecovery?.recoveredPages ?? []);
  const old = new Map(normalizeCandidateWarnings(previous ?? {}).map((warning) => [warning.id, warning]));
  const kept: Record<string, ReviewCapability> = {};
  for (const warning of normalizeCandidateWarnings(next)) {
    const before = old.get(warning.id);
    if (!before || before.kind !== warning.kind) continue;
    const same = (row: WarningOccurrence) => !recovered.has(row.page)
      && before.occurrences.some((prior) => evidence(prior) === evidence(row));
    if (reviewUsesOccurrenceDecisions(warning)) {
      for (const row of warning.occurrences) {
        const action = decisions[row.id];
        if (action && same(row) && reviewOccurrenceActions(warning, row).includes(action)) kept[row.id] = action;
      }
    } else if (decisions[warning.id] && warning.availableActions.includes(decisions[warning.id])
      && warning.occurrences.length === before.occurrences.length && warning.occurrences.every(same)) {
      kept[warning.id] = decisions[warning.id];
    }
  }
  return ocrReviewDecisions(next, kept);
}

/** Choosing OCR already chooses its best-effort result; no second empty-page approval. */
export function ocrReviewDecisions(candidate: ReviewCandidate | undefined,
  decisions: Record<string, ReviewCapability>) {
  const next = { ...decisions };
  const checked = new Set([...(candidate?.ocrRecovery?.emptyPages ?? []),
    ...(candidate?.ocrRecovery?.unchangedPages ?? [])]);
  for (const warning of normalizeCandidateWarnings(candidate ?? {})) {
    if (!missingKinds.has(warning.kind)) continue;
    for (const row of warning.occurrences) {
      if (next[row.id] === undefined && checked.has(row.page)
        && reviewOccurrenceActions(warning, row).includes('keep')) next[row.id] = 'keep';
    }
  }
  return next;
}
