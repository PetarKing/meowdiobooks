import { afterEach, describe, expect, it } from "vitest";
import { ActionRequiredError } from "../api/actionRequired";
import i18n, { changeAppLocale } from "../i18n";
import { localizeErrorMessage, localizeProcessMessage, message, userFacingDetail } from "./presentation";

afterEach(async () => { await changeAppLocale("en"); });

describe("workflow service copy boundary", () => {
  it.each(["en", "zh-CN"] as const)("presents old and unknown provider progress without diagnostics in %s", async (locale) => {
    await changeAppLocale(locale);
    for (const raw of [
      "Checking 42 text windows with Luna Decisions",
      "Checking cleanup with Luna",
      "Luna cleanup proposals are ready for review",
      "Checking speaker assignments with gpt-private-provider",
      "Running Dual pass with tools",
      "Building contextual identity dossiers",
      "Model xyz backend endpoint: https://provider.example/api",
      "Brand-new internal worker state",
    ]) {
      const rendered = localizeProcessMessage(raw, i18n.t);
      expect(rendered).not.toMatch(/Luna|Decisions|gpt-|provider|API|endpoint|dossiers|Dual pass|internal worker/i);
      expect(rendered).not.toBe(raw);
      if (locale === "zh-CN") expect(rendered).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("preserves useful progress counts and character names, including names that match a model", () => {
    expect(localizeProcessMessage("Extracted page 7 of 12", i18n.t)).toBe("Extracted page 7 of 12");
    expect(localizeProcessMessage("Auditioning Luna (2 of 4)", i18n.t)).toBe("Auditioning Luna (2 of 4)");
  });

  it("keeps actionable file and language errors, but does not display raw service exceptions", () => {
    expect(message(new Error("Use a PDF"))).toBe("Use a PDF");
    expect(message(new Error("Select a supported voice language"))).toBe("Select a supported voice language");
    expect(message(new Error("Voice sample must be between 3 and 30 seconds"))).toBe("Voice sample must be between 3 and 30 seconds");
    expect(message(new Error("Imported source integrity check failed; re-import the PDF"))).toBe("Import the PDF again before continuing.");
    for (const raw of ["Decisions returned an invalid cleanup answer", "Luna API returned JSON", "stage did not return a candidate revision", "An unknown internal diagnostic"]) {
      expect(message(new Error(raw))).toBe("Something went wrong while completing this step. Try again; your accepted work is unchanged.");
    }
  });

  it("preserves public host recovery actions and suppresses only handled ones", () => {
    const action = { code: "capacity", message: "Your workspace is full. Remove a book to continue.", context: {} };
    expect(message(new ActionRequiredError(action))).toBe(action.message);
    expect(localizeErrorMessage(message(new ActionRequiredError(action)), i18n.t)).toBe(action.message);
    expect(message(new ActionRequiredError(action, { handled: true }))).toBe("");
  });

  it("preserves saved-progress recovery and support instructions", async () => {
    const pause = "Oops—voice generation paused at Luna. 12 of 61 completed voices are safely saved. Choose Continue voice generation below to resume the remaining voices.";
    expect(message(new Error(pause))).toBe(pause);
    expect(localizeErrorMessage(message(new Error(pause)), i18n.t)).toBe("Voice generation paused at Luna. 12 of 61 voices are saved. Choose Continue voice generation to resume.");
    for (const actionable of [
      "Audiobook processing is temporarily paused for this account. Your saved work is still available. Please contact support if you need help continuing.",
      "Your saved voices need to be updated. Generate new auditions and accept the cast before generating audio.",
      "Choose a language supported by these voices.",
    ]) expect(message(new Error(actionable))).toBe(actionable);
    expect(message(new Error("Audio generation is temporarily rate-limited. Completed audio is saved; try continuing generation in about one minute. Reference: internal-123."))).toBe("Audio generation is temporarily busy. Completed audio is saved; try continuing in about one minute.");
    await changeAppLocale("zh-CN");
    expect(localizeErrorMessage(message(new Error(pause)), i18n.t)).toContain("12/61");
    expect(localizeErrorMessage(message(new Error(pause)), i18n.t)).toContain("继续生成声音");
  });

  it("keeps useful correction explanations but replaces operational details", () => {
    const fallback = "Compare the highlighted text with your PDF.";
    expect(userFacingDetail("A word is split across two lines.", fallback)).toBe("A word is split across two lines.");
    expect(userFacingDetail("Luna returned overlapping source offsets", fallback)).toBe(fallback);
  });
});
