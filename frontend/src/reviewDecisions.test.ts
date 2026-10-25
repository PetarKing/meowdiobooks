import { scriptDirectionsWarning } from "../design-kit/scriptDirectionsFixture";
import { describe, expect, it, vi } from "vitest";
import type { ReviewWarning } from "./api/contracts";
import { buildReviewPreviewPolicies, buildReviewWarningDecisions } from "./reviewDecisions";
import { normalizeCandidateWarnings, reviewOccurrenceActions, reviewProposalDecisions, reviewWarningResolved, reviewActionTitle, reviewConsequence, reviewIsVerifiedScriptGroup, reviewScriptCueDecisions } from "./workflow/review";

import { cleanupWarning, consolidatedCleanupWarning } from "../design-kit/cleanupFixture";

describe("AI cleanup decisions", () => {
  it("retains deletion and row-specific capabilities when a candidate is restored", () => {
    const restored = normalizeCandidateWarnings(JSON.parse(JSON.stringify({ warnings: [cleanupWarning] })))[0];
    expect(restored.occurrences[1].replacement).toBe("");
    expect(restored.occurrences[0].reason).toBe(cleanupWarning.occurrences[0].reason);
    expect(reviewOccurrenceActions(restored, restored.occurrences[2])).toEqual(["keep", "exclude"]);
    expect(reviewWarningResolved(restored, { "ai-group": "repair" })).toBe(false);
  });

  it("bulk applies only actual corrections and leaves unresolved source checks pending", () => {
    const choices = reviewProposalDecisions(cleanupWarning, { join: "keep" });
    expect(choices).toEqual({ join: "keep", delete: "repair" });
    expect(reviewProposalDecisions(cleanupWarning, { join: "repair", delete: "keep" })).toEqual({ join: "repair", delete: "keep" });
    expect(reviewProposalDecisions(cleanupWarning, choices)).toEqual(choices);
    const overridden = { ...choices, delete: "exclude" } as const;
    expect(reviewProposalDecisions(cleanupWarning, overridden)).toEqual(overridden);
    expect(reviewProposalDecisions(cleanupWarning, { join: "keep", delete: "exclude" })).toEqual({ join: "keep", delete: "exclude" });
    expect(reviewWarningResolved(cleanupWarning, choices)).toBe(false);
    expect(reviewWarningResolved(cleanupWarning, { ...choices, missing: "keep" })).toBe(true);
    const guarded = { ...cleanupWarning, occurrences: [{ ...cleanupWarning.occurrences[2], availableActions: ["keep", "repair"] as const }] };
    expect(reviewOccurrenceActions({ ...guarded, occurrences: [] }, { ...guarded.occurrences[0], availableActions: ["keep", "repair"] })).toEqual(["keep"]);
  });

  it.each(["narrator", "assigned-speaker", "mixed"] as const)("keeps AI copy about source text for %s readers without reader assumptions", (readerState) => {
    const warning = { ...cleanupWarning, readerState };
    expect(reviewOccurrenceActions(warning, warning.occurrences[0])).toEqual(["repair", "keep", "exclude"]);
    expect(reviewActionTitle("repair", warning)).toBe("Apply correction");
    expect(reviewActionTitle("keep", warning)).toBe("Keep");
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

  it("moves saved corrections into the last AI category while preserving individual source decisions", async () => {
    const warnings = normalizeCandidateWarnings(JSON.parse(JSON.stringify({ warnings: [consolidatedCleanupWarning] })));
    expect(warnings.map((warning) => warning.kind)).toEqual(["suspicious-extraction", "ai-cleanup"]);
    const [source, ai] = warnings;
    expect(source.decisionScope).toBe("occurrence");
    expect(source.occurrences.map((row) => row.id)).toEqual(["ordinary", "missing"]);
    expect(ai.occurrences.map((row) => row.id)).toEqual(["join", "delete"]);
    expect(ai.occurrences[0]).toMatchObject({ readerState: "assigned-speaker", cleanupReason: "Join a word split across a printed line.", proposalStatus: "proposed" });
    expect(reviewOccurrenceActions(source, source.occurrences[0])).toEqual(["keep", "exclude"]);
    const choices = reviewProposalDecisions(ai, { join: "keep", ordinary: "exclude", missing: "keep" });
    expect(choices).toEqual({ join: "keep", ordinary: "exclude", delete: "repair", missing: "keep" });
    expect(warnings.every((warning) => reviewWarningResolved(warning, choices))).toBe(true);
    const preview = vi.fn();
    const decisions = await buildReviewWarningDecisions("book", "rev", warnings, choices, preview);
    const rows = warnings.flatMap((warning) => warning.occurrences);
    expect(decisions).toEqual(rows.map((row) => ({ occurrenceIds: [row.id], action: choices[row.id], provenance: "user" })));
    expect(preview).not.toHaveBeenCalled();
    expect(buildReviewPreviewPolicies(warnings, choices)).toEqual({ policies: [], occurrencePolicies: rows.map((row) => ({ occurrenceId: row.id, action: choices[row.id] })) });
  });

  it("orders AI suggestions last, deduplicates IDs, and keeps unaffected categories grouped", () => {
    const front = { id: "front", kind: "front-back-matter", severity: "notice", availableActions: ["keep", "exclude"], occurrences: [{ id: "author", source: "About the author", page: 4 }] };
    const warnings = normalizeCandidateWarnings({ warnings: [cleanupWarning, front, consolidatedCleanupWarning] });
    expect(warnings.map((warning) => warning.kind)).toEqual(["front-back-matter", "suspicious-extraction", "ai-cleanup"]);
    expect(warnings[0].decisionScope).toBeUndefined();
    const ids = warnings.flatMap((warning) => warning.occurrences.map((row) => row.id));
    expect(ids.length).toBe(new Set(ids).size);
    expect(warnings[2].occurrences.find((row) => row.id === "join")?.replacement).toBe("broken");
  });

  it("does not invent Leave support for older saved AI candidates", () => {
    const warning = normalizeCandidateWarnings({ warnings: [{ ...cleanupWarning, occurrences: [{ ...cleanupWarning.occurrences[0], availableActions: ["keep", "repair"] }] }] })[0];
    expect(reviewOccurrenceActions(warning, warning.occurrences[0])).toEqual(["repair", "keep"]);
  });

  it("applies proposals across deterministic and AI categories without changing ordinary row choices", () => {
    const novel = { ...cleanupWarning, occurrences: [{ ...cleanupWarning.occurrences[0], id: "novel" }] };
    const choices = [consolidatedCleanupWarning, novel].reduce((selected, warning) => reviewProposalDecisions(warning, selected), { ordinary: "exclude", join: "keep", novel: "keep" } as Record<string, import("./api/contracts").ReviewCapability>);
    expect(choices).toEqual({ ordinary: "exclude", join: "keep", novel: "keep", delete: "repair" });
  });

  it("serializes separate choices with no identical-match bulk authorization", async () => {
    const preview = vi.fn();
    const choices = { join: "repair", delete: "keep", missing: "exclude" } as const;
    expect(await buildReviewWarningDecisions("book", "rev", [cleanupWarning], choices, preview)).toEqual([
      { occurrenceIds: ["join"], action: "repair", provenance: "user" },
      { occurrenceIds: ["delete"], action: "keep", provenance: "user" },
      { occurrenceIds: ["missing"], action: "exclude", provenance: "user" },
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


describe("verified script direction decisions", () => {
  it("restores a dedicated category and preserves 150 individual manual choices through repeat bulk application", () => {
    const many = { ...scriptDirectionsWarning, occurrences: Array.from({ length: 150 }, (_, i) => ({ ...scriptDirectionsWarning.occurrences[0], id: `cue-${i}` })) };
    const [restored] = normalizeCandidateWarnings(JSON.parse(JSON.stringify({ warnings: [many] })));
    expect(restored.kind).toBe("stage-direction");
    expect(reviewIsVerifiedScriptGroup(restored)).toBe(true);
    const selected = { "cue-0": "keep", "cue-1": "exclude", unrelated: "narrate" } as const;
    const applied = reviewScriptCueDecisions(restored, selected);
    expect(Object.keys(applied)).toHaveLength(151);
    expect(applied).toMatchObject(selected);
    expect(applied["cue-149"]).toBe("exclude");
    expect(reviewWarningResolved(restored, applied)).toBe(true);
    expect(reviewScriptCueDecisions(restored, { ...applied, "cue-149": "keep" })).toEqual({ ...applied, "cue-149": "keep" });
  });

  it("does not bulk infer omissions for legacy or unverified candidates", () => {
    for (const warning of [
      { ...scriptDirectionsWarning, decisionScope: "warning-kind" as const },
      { ...scriptDirectionsWarning, occurrences: [{ ...scriptDirectionsWarning.occurrences[0], cueVerification: undefined }] },
      { ...scriptDirectionsWarning, occurrences: [{ ...scriptDirectionsWarning.occurrences[0], recommendedAction: undefined }] },
    ]) {
      expect(reviewIsVerifiedScriptGroup(warning)).toBe(false);
      expect(reviewScriptCueDecisions(warning, {})).toEqual({});
    }
    const legacy: ReviewWarning = { ...scriptDirectionsWarning, decisionScope: "warning-kind", availableActions: ["keep", "narrate", "exclude"] };
    expect(reviewOccurrenceActions(legacy, legacy.occurrences[0])).toEqual(["keep", "exclude", "narrate"]);
  });
});


it("preserves only explicit continuous context metadata through normalization", () => {
  const rows = ["continuous", undefined, "guessed"].map((contextLayout, i) => ({
    ...cleanupWarning.occurrences[0], id: `context-${i}`, contextLayout,
  }));
  const [warning] = normalizeCandidateWarnings({ warnings: [{ ...cleanupWarning, occurrences: rows }] });
  expect(warning.occurrences.map((row) => row.contextLayout)).toEqual(["continuous", undefined, undefined]);
});
