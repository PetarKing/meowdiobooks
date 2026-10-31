import { describe, expect, it, vi } from "vitest";
import type { WarningOccurrence } from "./api/contracts";
import { buildReviewPreviewPolicies, buildReviewWarningDecisions } from "./reviewDecisions";
import { normalizeCandidateWarnings, reviewDefaultDecisions, reviewHasBoundaryEvidence, reviewOccurrenceActions, reviewProposalDecisions, reviewWarningResolved } from "./workflow/review";

const boundary: Partial<WarningOccurrence> = {
  boundaryDecision: "UNSURE", boundarySource: "hereyes",
  boundaryAnchors: [
    { blockId: "p1", spanId: "s1", sourceStart: 10, sourceEnd: 13, source: "her", page: 1 },
    { blockId: "p2", spanId: "s2", sourceStart: 0, sourceEnd: 4, source: "eyes", page: 2 },
  ],
};
const candidate = { warnings: [{ id: "ai", kind: "ai-cleanup", availableActions: ["keep", "repair"], occurrences: [
  { ...boundary, id: "verified", source: "her", page: 1, boundaryDecision: "SPACE", replacement: "her eyes", proposalStatus: "proposed" },
  { ...boundary, id: "uncertain", source: "her", page: 1, proposalStatus: "source_review" },
] }] };

describe("page-boundary source preservation", () => {
  it.each(["UNSURE", "NO_CONTINUATION"])("defaults %s boundaries to keep and bulk applies only proposals through preview and acceptance", async (boundaryDecision) => {
    const [warning] = normalizeCandidateWarnings({ warnings: [{ ...candidate.warnings[0], occurrences: [
      candidate.warnings[0].occurrences[0], { ...candidate.warnings[0].occurrences[1], boundaryDecision },
    ] }] });
    expect(warning.occurrences[1]).toMatchObject({ ...boundary, boundaryDecision });
    expect(reviewOccurrenceActions(warning, warning.occurrences[1])).toEqual(["keep"]);
    const defaults = reviewDefaultDecisions([warning], {});
    expect(defaults).toEqual({ uncertain: "keep" });
    const applied = reviewProposalDecisions(warning, defaults);
    expect(applied).toEqual({ uncertain: "keep", verified: "repair" });
    expect(reviewWarningResolved(warning, applied)).toBe(true);
    expect(buildReviewPreviewPolicies([warning], { verified: "repair" }).occurrencePolicies).toEqual([
      { occurrenceId: "verified", action: "repair" }, { occurrenceId: "uncertain", action: "keep" },
    ]);
    expect(await buildReviewWarningDecisions("b", "r", [warning], { verified: "repair" }, vi.fn())).toEqual([
      { occurrenceIds: ["verified"], action: "repair", provenance: "user" },
      { occurrenceIds: ["uncertain"], action: "keep", provenance: "user" },
    ]);
  });

  it("preserves manual choices and does not default ordinary or malformed source checks", () => {
    const [warning] = normalizeCandidateWarnings(candidate);
    const choices = { uncertain: "keep", verified: "keep" } as const;
    expect(reviewProposalDecisions(warning, reviewDefaultDecisions([warning], choices))).toEqual(choices);
    for (const mutation of [
      { boundaryDecision: undefined }, { boundaryDecision: "unknown" }, { boundaryDecision: {} },
      { boundaryAnchors: [] }, { boundaryAnchors: [null, null] }, { boundarySource: undefined },
      { boundaryAnchors: [{ ...boundary.boundaryAnchors![0], sourceStart: -1 }, boundary.boundaryAnchors![1]] },
    ]) {
      const [invalid] = normalizeCandidateWarnings({ warnings: [{ ...candidate.warnings[0], occurrences: [
        { ...candidate.warnings[0].occurrences[1], ...mutation },
      ] }] });
      expect(reviewHasBoundaryEvidence(invalid.occurrences[0])).toBe(false);
      expect(reviewDefaultDecisions([invalid], {})).toEqual({});
      expect(reviewWarningResolved(invalid, {})).toBe(false);
    }
  });
});
