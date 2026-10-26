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
