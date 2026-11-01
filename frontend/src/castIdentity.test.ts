import { describe, expect, it } from "vitest";
import type { CastArtifact } from "./api/contracts";
import { strongConfirmationLabelsForCast } from "./castIdentity";
import { decisionsForCast, resolvedLabelsForCast } from "./workflow/cast";

function groupedCast(labels: string[], category = "character"): CastArtifact {
  return {
    revision: "cast-test", phase: "identity-review", dossiers: [],
    proposals: labels.map((label) => ({
      label, category, canonicalName: labels[0],
      aliases: labels.filter((other) => other !== label), reviewRequired: true,
    })),
  };
}

describe("grouping confirmation", () => {
  it.each([
    ["Subaru", "Natsuki Subaru"],
    ["Subaru", "Natsuki Subaru", "Sir Natsuki Subaru"],
    [" SUBARU ", "Natsuki   Subaru"],
    ["Ａｌｉｃｅ", "Alice Liddell"],
    ["Elizabeth", "Miss Elizabeth Bennet"],
  ])("allows nested names: %j", (...labels) => {
    const cast = groupedCast(labels);
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toEqual([]);
    expect(resolvedLabelsForCast(cast)).toEqual(labels);
  });

  it.each([
    ["Ann", "Anna"],
    ["Smith", "John Smith", "Jane Smith"],
    ["John", "Smith", "John Smith"],
    ["Subaru", "Natsuki Subaru", "Little knight"],
    ["Natsuki Subaru", "Subaru Natsuki"],
  ])("still requires confirmation for ambiguous names: %j", (...labels) => {
    const cast = groupedCast(labels);
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toEqual(labels);
  });

  it("keeps non-character classifications mandatory", () => {
    const cast = groupedCast(["Guards", "Royal Guards"], "group");
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toEqual(["Guards", "Royal Guards"]);
  });

  it("does not group separate labels just because their names nest", () => {
    const cast = groupedCast(["Subaru", "Natsuki Subaru"]);
    cast.proposals.forEach((proposal) => { proposal.aliases = []; });
    const decisions = decisionsForCast(cast);
    expect(decisions.Subaru.primaryLabel).toBe("Subaru");
    expect(decisions["Natsuki Subaru"].primaryLabel).toBe("Natsuki Subaru");
  });

  it("evaluates the entire current group, including unflagged members", () => {
    const cast = groupedCast(["Subaru", "Natsuki Subaru", "Little knight"]);
    cast.proposals[2].reviewRequired = false;
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toEqual(["Subaru", "Natsuki Subaru"]);
  });
});


describe("editorial narrator defaults", () => {
  const editorial = (): CastArtifact => ({
    revision: "editorial-draft", phase: "identity-review", dossiers: [],
    proposals: [{ label: "Production credit", category: "editorial", canonicalName: "", reviewRequired: true }],
  });

  it("assigns non-speaker material to Narrator pending a grouped review", () => {
    const cast = editorial();
    const decisions = decisionsForCast(cast);
    expect(decisions["Production credit"]).toMatchObject({ category: "narrator", canonicalName: "" });
    expect(resolvedLabelsForCast(cast)).toEqual([]);
    expect(strongConfirmationLabelsForCast(cast, decisions)).toEqual(["Production credit"]);
    expect(cast.proposals[0].category).toBe("editorial");
  });

  it.each(["aliases", "competingLabels"] as const)("keeps editorial %s conflicts for review", (field) => {
    const cast = editorial();
    cast.proposals[0][field] = ["Mara"];
    expect(decisionsForCast(cast)["Production credit"].category).toBe("editorial");
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toEqual(["Production credit"]);
  });

  it.each(["aliases", "competingLabels"] as const)("keeps incoming %s conflicts visible", (field) => {
    const cast = editorial();
    cast.proposals.push({ label: "Mara", category: "character", canonicalName: "Mara", [field]: ["Production credit"], reviewRequired: true });
    expect(decisionsForCast(cast)["Production credit"].category).toBe("editorial");
    expect(strongConfirmationLabelsForCast(cast, decisionsForCast(cast))).toContain("Production credit");
  });

  it("preserves saved decisions instead of reapplying the default", () => {
    const cast = editorial();
    cast.identityDecisions = [{ label: "Production credit", category: "character", canonicalName: "Mara", aliases: [] }];
    expect(decisionsForCast(cast)["Production credit"].category).toBe("character");
  });

  it.each(["character", "group", "unresolved-marker"])("never infers narrator routing from a short %s role", (category) => {
    const cast = editorial();
    cast.proposals[0] = { label: "Mara", category, canonicalName: category === "unresolved-marker" ? "" : "Mara", reviewRequired: true };
    cast.dossiers = [{ label: "Mara", occurrenceCount: 1, examples: [{ sourceText: "Hello." }] }];
    expect(decisionsForCast(cast).Mara.category).toBe(category);
  });
});
