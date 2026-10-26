import { describe, expect, it } from "vitest";
import { speakerAccent } from "./speakerColor";

describe("transcript speaker identity", () => {
  it("keeps accents stable across display spelling and Unicode normalization", () => {
    expect(speakerAccent("  Petra   Leyte ")).toBe(speakerAccent("PETRA LEYTE"));
    expect(speakerAccent("E\u0301mile")).toBe(speakerAccent("Émile"));
  });

  it("distinguishes the speakers from the reported dialogue", () => {
    expect(speakerAccent("Subaru Natsuki")).not.toBe(speakerAccent("Petra Leyte"));
  });
});
