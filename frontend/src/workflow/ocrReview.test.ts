import { describe, expect, it } from 'vitest';
import type { ReviewCandidate, ReviewWarning } from '../api/contracts';
import { carryOcrReviewDecisions, ocrReviewDecisions, remainingOcrPages } from './ocrReview';
import { normalizeCandidateWarnings } from './review';

const warning = (kind: string, pages: number[], id = kind): ReviewWarning => ({
  id, kind, severity: 'warning', decisionScope: 'occurrence', detail: 'Synthetic source check',
  availableActions: ['keep'], occurrences: pages.map((page) => ({ id: `${kind}-${page}`, page,
    blockId: `p${page}-b1`, sourceStart: 0, sourceEnd: 0, source: '', text: '' })),
});
const candidate = (warnings: ReviewWarning[]): ReviewCandidate => ({ revision: 'review-1', warnings: warnings as unknown as Array<Record<string, unknown>> });

describe('OCR in the normal Review flow', () => {
  it('bulk targets only unresolved physical pages in both missing-text categories', () => {
    expect(remainingOcrPages([warning('empty-page', [7, 115]), warning('missing-image-text', [115, 124]),
      warning('page-number', [6])], { 'empty-page-7': 'keep' })).toEqual([115, 124]);
  });

  it('OCR no-change outcomes need no second approval and affect only attempted missing pages', () => {
    const checked = candidate([warning('empty-page', [7, 8]), warning('missing-image-text', [124]), warning('page-number', [124])]);
    checked.ocrRecovery = { requestedPages: [7, 124], recoveredPages: [], emptyPages: [7], unchangedPages: [124] };
    expect(ocrReviewDecisions(checked, {})).toEqual({ 'empty-page-7': 'keep', 'missing-image-text-124': 'keep' });
    expect(ocrReviewDecisions(checked, { 'page-number-124': 'exclude' })).toEqual({
      'empty-page-7': 'keep', 'missing-image-text-124': 'keep', 'page-number-124': 'exclude',
    });
  });

  it('retains independent exact-evidence decisions but resets changed recovered-page decisions', () => {
    const previous = candidate([warning('empty-page', [7, 115]), warning('missing-image-text', [124])]);
    const next = { ...previous, revision: 'review-2', ocrRecovery: {
      requestedPages: [115, 124], recoveredPages: [115], emptyPages: [], unchangedPages: [124],
    } };
    expect(carryOcrReviewDecisions(previous, next, { 'empty-page-7': 'keep', 'empty-page-115': 'keep' })).toEqual({
      'empty-page-7': 'keep', 'missing-image-text-124': 'keep',
    });
  });

  it('never carries a group decision after membership changes or a reused ID after source changes', () => {
    const group = { ...warning('page-number', [1, 2], 'folios'), decisionScope: 'warning-kind' as const };
    const previous = candidate([group]);
    const changed = candidate([{ ...group, occurrences: group.occurrences.slice(1) }]);
    expect(carryOcrReviewDecisions(previous, changed, { folios: 'keep' })).toEqual({});
    const independent = candidate([warning('empty-page', [1])]);
    const modified = structuredClone(independent);
    modified.warnings![0].occurrences = [{ ...warning('empty-page', [1]).occurrences[0], source: 'Changed' }];
    expect(carryOcrReviewDecisions(independent, modified, { 'empty-page-1': 'keep' })).toEqual({});
  });

  it('retains explicit source offsets through warning normalization for safe reuse', () => {
    const rows = normalizeCandidateWarnings(candidate([warning('empty-page', [124])]))[0].occurrences;
    expect(rows[0]).toMatchObject({ blockId: 'p124-b1', sourceStart: 0, sourceEnd: 0, page: 124 });
  });
});
