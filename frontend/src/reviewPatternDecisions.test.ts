import { describe, expect, it, vi } from "vitest";
import type { ReviewWarning } from "./api/contracts";
import { buildReviewPreviewPolicies, buildReviewWarningDecisions } from "./reviewDecisions";
import { normalizeCandidateWarnings, reviewIsPatternGroup, reviewPatternDecisions, reviewWarningResolved } from "./workflow/review";

function candidate(count = 400) {
  return { warnings: [{ id: "backend-family", kind: "ai-cleanup", decisionScope: "occurrence", availableActions: ["keep", "exclude", "repair"],
    occurrences: Array.from({ length: count }, (_, i) => ({ id: `footer-${i}`, page: i + 1, source: `Publisher ${i + 1}`,
      replacement: "", proposalStatus: "proposed", patternGroupId: "numbered-footer-1", patternVerification: "verified",
      availableActions: ["keep", "exclude", "repair"] })) }] };
}

describe("verified repeated page text", () => {
  it("resolves 400 occurrences once without collapsing source identity or overwriting manual exceptions", async () => {
    const warnings = normalizeCandidateWarnings(candidate());
    const [warning] = warnings;
    expect(warnings).toHaveLength(1);
    expect(warning.kind).toBe("repeated-page-text");
    expect(reviewIsPatternGroup(warning)).toBe(true);
    expect(warning.occurrences).toHaveLength(400);
    const chosen = reviewPatternDecisions(warning, { "footer-9": "keep", other: "keep" }, "exclude");
    expect(chosen["footer-9"]).toBe("keep");
    expect(chosen.other).toBe("keep");
    expect(Object.values(chosen).filter((action) => action === "exclude")).toHaveLength(399);
    expect(reviewPatternDecisions(warning, chosen, "keep")).toEqual(chosen);
    expect(reviewWarningResolved(warning, chosen)).toBe(true);
    const previewBulk = vi.fn();
    const decisions = await buildReviewWarningDecisions("b", "r", warnings, chosen, previewBulk);
    expect(decisions).toHaveLength(400);
    expect(decisions.every((row) => row.occurrenceIds.length === 1 && !row.previewToken)).toBe(true);
    expect(previewBulk).not.toHaveBeenCalled();
    expect(buildReviewPreviewPolicies(warnings, chosen).occurrencePolicies).toHaveLength(400);
    expect(normalizeCandidateWarnings(JSON.parse(JSON.stringify({ warnings })))).toEqual(warnings);
  });

  it("keeps independent families and unrelated AI proposals separate", () => {
    const input = candidate(3);
    input.warnings[0].occurrences[1].patternGroupId = "other-family";
    input.warnings[0].occurrences[2].patternVerification = "unknown";
    const warnings = normalizeCandidateWarnings(input);
    expect(warnings.map((warning) => warning.kind)).toEqual(["repeated-page-text", "repeated-page-text", "ai-cleanup"]);
    const chosen = reviewPatternDecisions(warnings[0], {}, "keep");
    expect(chosen).toEqual({ "footer-0": "keep" });
    expect(reviewPatternDecisions(warnings[2], {}, "exclude")).toEqual({});
  });

  it.each(["unverified", "replacement", "source-review", "empty-id", "missing-exclude"])("does not grant family action for %s metadata", (mutation) => {
    const input = candidate(1);
    const row = input.warnings[0].occurrences[0];
    if (mutation === "unverified") row.patternVerification = "guessed";
    if (mutation === "replacement") row.replacement = "rewritten";
    if (mutation === "source-review") row.proposalStatus = "source_review";
    if (mutation === "empty-id") row.patternGroupId = "";
    if (mutation === "missing-exclude") row.availableActions = ["keep", "repair"];
    const [warning] = normalizeCandidateWarnings(input);
    expect(warning.kind).toBe("ai-cleanup");
    expect(reviewPatternDecisions(warning, {}, "exclude")).toEqual({});
  });

  it("preserves a restored deletion repair choice as an individual decision", () => {
    const [warning] = normalizeCandidateWarnings(candidate(1));
    expect(reviewWarningResolved(warning, { "footer-0": "repair" })).toBe(true);
    expect(reviewPatternDecisions(warning, { "footer-0": "repair" }, "keep")).toEqual({ "footer-0": "repair" });
    const unsafe = { ...warning, occurrences: [{ ...warning.occurrences[0], patternGroupId: "different" }] } as ReviewWarning;
    expect(reviewPatternDecisions(unsafe, {}, "exclude")).toEqual({});
  });
});
