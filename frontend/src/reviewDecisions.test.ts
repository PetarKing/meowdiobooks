import { describe, expect, it, vi } from "vitest";
import type { ReviewWarning } from "./api/contracts";
import { buildReviewPreviewPolicies, buildReviewWarningDecisions } from "./reviewDecisions";
import { normalizeCandidateWarnings, reviewOccurrenceActions, reviewProposalDecisions, reviewWarningResolved } from "./workflow/review";

import { cleanupWarning } from "../design-kit/cleanupFixture";

describe("AI cleanup decisions", () => {
  it("retains deletion and row-specific capabilities when a candidate is restored", () => {
    const restored = normalizeCandidateWarnings(JSON.parse(JSON.stringify({ warnings: [cleanupWarning] })))[0];
    expect(restored.occurrences[1].replacement).toBe("");
    expect(restored.occurrences[0].reason).toBe(cleanupWarning.occurrences[0].reason);
    expect(reviewOccurrenceActions(restored, restored.occurrences[2])).toEqual(["keep", "rerun-extraction"]);
    expect(reviewWarningResolved(restored, { "ai-group": "repair" })).toBe(false);
  });

  it("bulk applies only actual corrections and leaves unresolved source checks pending", () => {
    const choices = reviewProposalDecisions(cleanupWarning, { join: "keep" });
    expect(choices).toEqual({ join: "repair", delete: "repair" });
    expect(reviewWarningResolved(cleanupWarning, choices)).toBe(false);
    expect(reviewWarningResolved(cleanupWarning, { ...choices, missing: "keep" })).toBe(true);
    const guarded = { ...cleanupWarning, occurrences: [{ ...cleanupWarning.occurrences[2], availableActions: ["keep", "repair"] as const }] };
    expect(reviewOccurrenceActions({ ...guarded, occurrences: [] }, { ...guarded.occurrences[0], availableActions: ["keep", "repair"] })).toEqual(["keep"]);
  });

  it("serializes separate choices with no identical-match bulk authorization", async () => {
    const preview = vi.fn();
    const choices = { join: "repair", delete: "keep", missing: "rerun-extraction" } as const;
    expect(await buildReviewWarningDecisions("book", "rev", [cleanupWarning], choices, preview)).toEqual([
      { occurrenceIds: ["join"], action: "repair", provenance: "user" },
      { occurrenceIds: ["delete"], action: "keep", provenance: "user" },
      { occurrenceIds: ["missing"], action: "rerun-extraction", provenance: "user" },
    ]);
    expect(preview).not.toHaveBeenCalled();
    await expect(buildReviewWarningDecisions("book", "rev", [cleanupWarning], { ...choices, missing: "repair" }, preview)).rejects.toThrow("supported action");
  });

  it("keeps group policies separate from occurrence preview policies", () => {
    const ordinary = { ...cleanupWarning, id: "footer-group", kind: "page-number", availableActions: ["keep", "exclude"] } as ReviewWarning;
    expect(buildReviewPreviewPolicies([ordinary, cleanupWarning], { "footer-group": "exclude", "ai-group": "repair", join: "repair", delete: "keep", missing: "keep", stale: "repair" })).toEqual({
      policies: [{ warningId: "footer-group", action: "exclude" }],
      occurrencePolicies: [{ occurrenceId: "join", action: "repair" }, { occurrenceId: "delete", action: "keep" }, { occurrenceId: "missing", action: "keep" }],
    });
  });
});
