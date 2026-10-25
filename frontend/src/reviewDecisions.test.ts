import { describe, expect, it, vi } from "vitest";
import type { ReviewWarning } from "./api/contracts";
import { buildReviewPreviewPolicies, buildReviewWarningDecisions } from "./reviewDecisions";
import { normalizeCandidateWarnings, reviewOccurrenceActions, reviewProposalDecisions, reviewWarningResolved, reviewActionTitle, reviewConsequence } from "./workflow/review";

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
    expect(choices).toEqual({ join: "keep", delete: "repair" });
    expect(reviewProposalDecisions(cleanupWarning, { join: "repair", delete: "keep" })).toEqual({ join: "repair", delete: "keep" });
    expect(reviewWarningResolved(cleanupWarning, choices)).toBe(false);
    expect(reviewWarningResolved(cleanupWarning, { ...choices, missing: "keep" })).toBe(true);
    const guarded = { ...cleanupWarning, occurrences: [{ ...cleanupWarning.occurrences[2], availableActions: ["keep", "repair"] as const }] };
    expect(reviewOccurrenceActions({ ...guarded, occurrences: [] }, { ...guarded.occurrences[0], availableActions: ["keep", "repair"] })).toEqual(["keep"]);
  });

  it.each(["narrator", "assigned-speaker", "mixed"] as const)("keeps AI copy about source text for %s readers and puts correction first", (readerState) => {
    const warning = { ...cleanupWarning, readerState };
    expect(reviewOccurrenceActions(warning, warning.occurrences[0])).toEqual(["repair", "keep"]);
    expect(reviewActionTitle("repair", warning)).toBe("Apply correction");
    expect(reviewActionTitle("keep", warning)).toBe("Keep original text");
    expect(reviewConsequence("keep", warning)).toBe("Keep the original text for this suggestion.");
    expect(reviewConsequence("repair", warning)).not.toMatch(/narrator/i);
  });

  it.each(["suspicious-extraction", "repeated-matter", "page-number", "stage-direction", "web-address", "footnote", "front-back-matter"])("describes actual readers accurately for %s", (kind) => {
    const warning = { ...cleanupWarning, kind };
    expect(reviewActionTitle("keep", { ...warning, readerState: "narrator" })).toBe("Keep with narrator");
    expect(reviewConsequence("keep", { ...warning, readerState: "narrator" })).toContain("read by the narrator");
    for (const readerState of ["assigned-speaker", "mixed"] as const) {
      expect(reviewActionTitle("keep", { ...warning, readerState })).toBe("Keep as is");
      expect(reviewConsequence("keep", { ...warning, readerState })).toContain("current readers");
      expect(reviewConsequence("keep", { ...warning, readerState })).not.toMatch(/narrator/i);
    }
    expect(reviewConsequence("narrate", { ...warning, readerState: "assigned-speaker" })).toContain("narrator instead");
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
