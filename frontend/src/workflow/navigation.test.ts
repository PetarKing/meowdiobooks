import { describe, expect, it } from "vitest";

import { publicJourney } from "./navigation";


describe("JourneyDefinition", () => {
  it("supports private insertion and removal without changing public defaults", () => {
    const hosted = publicJourney
      .insertAfter("cast", {
        id: "hosted-sample",
        label: "Sample",
        completionStage: "cast",
      })
      .remove("enrich");

    expect(hosted.steps.map((step) => step.id)).toEqual([
      "extract",
      "dialogue",
      "review",
      "cast",
      "hosted-sample",
      "generate",
      "export",
    ]);
    expect(publicJourney.steps.map((step) => step.id)).toContain("enrich");
  });

  it("supports replacing a private view at one explicit step", () => {
    const hosted = publicJourney.replace("generate", {
      id: "generate",
      label: "Purchase & generate",
      builtin: "generate",
    });

    expect(hosted.step("generate").label).toBe("Purchase & generate");
    expect(publicJourney.step("generate").label).toBe("Generate");
  });

  it("groups contiguous backend stages into one visible customer step", () => {
    const hosted = publicJourney.group(
      ["extract", "dialogue", "review"],
      { id: "prepare", label: "Prepare", completionStage: "review" },
    );

    expect(hosted.steps.slice(0, 3).map((step) => step.id)).toEqual([
      "prepare",
      "cast",
      "enrich",
    ]);
    expect(hosted.next(["import", "extract", "dialogue"])).toBe(0);
  });

  it("rejects non-contiguous groups", () => {
    expect(() => publicJourney.group(
      ["extract", "review"],
      { id: "prepare", label: "Prepare", completionStage: "review" },
    )).toThrow("contiguous");
  });
});
