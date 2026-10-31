import { describe, expect, it } from "vitest";

import { publicJourney } from "./navigation";


describe("JourneyDefinition", () => {
  it("supports custom insertion and removal without changing public defaults", () => {
    const extended = publicJourney
      .insertAfter("cast", {
        id: "custom-sample",
        label: "Sample",
        completionStage: "cast",
      })
      .insertAfter("custom-sample", { id: "temporary", label: "Temporary" })
      .remove("temporary");

    expect(extended.steps.map((step) => step.id)).toEqual([
      "extract",
      "dialogue",
      "review",
      "cast",
      "custom-sample",
      "generate",
      "export",
    ]);
    expect(publicJourney.steps.map((step) => step.id)).not.toContain("custom-sample");
  });

  it("supports replacing a custom view at one explicit step", () => {
    const extended = publicJourney.replace("generate", {
      id: "generate",
      label: "Custom generate",
      builtin: "generate",
    });

    expect(extended.step("generate").label).toBe("Custom generate");
    expect(publicJourney.step("generate").label).toBe("Generate");
  });

  it("groups contiguous backend stages into one visible journey step", () => {
    const extended = publicJourney.group(
      ["extract", "dialogue", "review"],
      { id: "prepare", label: "Prepare", completionStage: "review" },
    );

    expect(extended.steps.slice(0, 3).map((step) => step.id)).toEqual([
      "prepare",
      "cast",
      "generate",
    ]);
    expect(extended.next(["import", "extract", "dialogue"])).toBe(0);
  });

  it("opens Generate immediately after cast approval", () => {
    expect(publicJourney.steps.map((step) => step.id)).toEqual([
      "extract", "dialogue", "review", "cast", "generate", "export",
    ]);
    expect(publicJourney.next(["import", "extract", "dialogue", "review", "cast"])).toBe(4);
  });

  it("rejects non-contiguous groups", () => {
    expect(() => publicJourney.group(
      ["extract", "review"],
      { id: "prepare", label: "Prepare", completionStage: "review" },
    )).toThrow("contiguous");
  });
});
