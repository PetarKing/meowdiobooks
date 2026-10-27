import { afterEach, describe, expect, it } from "vitest";
import { ActionRequiredError } from "../api/actionRequired";
import i18n, { changeAppLocale } from "../i18n";
import { formatFileSize, localizeErrorMessage, localizeProcessMessage, message, userFacingDetail } from "./presentation";
import { reviewGuidance } from "./review";
import type { ReviewWarning } from "../api/contracts";

afterEach(async () => { await changeAppLocale("en"); });

describe("workflow service copy boundary", () => {
  it.each(["en", "zh-CN"] as const)("explains overlapping review choices in %s without diagnostics", async (locale) => {
    await changeAppLocale(locale);
    const raw = "Cleanup repair crosses another review decision; keep it or revise that decision";
    const copy = message(new Error(raw));
    expect(copy).toBe("A correction overlaps another review choice. Keep the original text for that correction or revise the overlapping choice.");
    const rendered = localizeErrorMessage(copy, i18n.t);
    if (locale === "en") expect(rendered).toBe(copy);
    else expect(rendered).toMatch(/[\u4e00-\u9fff]/);
    expect(message(new Error(`${raw}: /private/operator-data`))).toContain("Something went wrong");
  });
  it.each(["en", "zh-CN"] as const)("translates reviewed operation failures and keeps a support reference in %s", async (locale) => {
    await changeAppLocale(locale);
    const reference = "0123456789abcdef0123456789abcdef";
    for (const base of [
      "We couldn’t create the audio. Please try again.",
      "We couldn’t transcribe the voice sample. Please try again.",
      "We couldn’t read this voice sample. Please try another recording.",
      "We couldn’t create the audiobook download. Please try again.",
      "We couldn’t create this page preview. Please try again.",
      "We couldn’t read this document. Please try again or upload another file.",
    ]) {
      const raw = `${base} Reference: ${reference}.`;
      expect(message(new Error(raw))).toBe(raw);
      const rendered = localizeErrorMessage(message(new Error(raw)), i18n.t);
      expect(rendered).toContain(reference);
      if (locale === "en") expect(rendered).toBe(raw);
      else {
        expect(rendered).toContain("参考编号");
        expect(rendered).not.toContain(base);
      }
    }
  });

  it("rejects unknown or malformed reference-bearing failures", () => {
    const base = "We couldn’t create the audio. Please try again.";
    for (const raw of [
      `An unknown diagnostic. Reference: ${"a".repeat(32)}.`,
      `${base} Reference: ${"A".repeat(32)}.`,
      `${base} Reference: ${"a".repeat(31)}.`,
      `${base} Reference: ${"a".repeat(33)}.`,
      `${base} Reference: token-secret.`,
      `${base} Reference: ${"a".repeat(32)}.\n`,
      `${base} Reference: ${"a".repeat(32)}. extra`,
    ]) expect(message(new Error(raw))).toBe("Something went wrong while completing this step. Try again; your accepted work is unchanged.");
  });

  it.each(["en", "zh-CN"] as const)("keeps reviewed failure recovery copy in %s", async (locale) => {
    await changeAppLocale(locale);
    for (const raw of [
      "We couldn’t transcribe the voice sample. Please try again.",
      "We couldn’t prepare the voice sample. Please try again.",
      "We couldn’t create the voice audition. Please try again.",
      "We couldn’t create the audiobook download. Please try again.",
      "Audio export is temporarily unavailable. Please try again later.",
      "The voice draft changed. Refresh before adding or removing auditions.",
      "Review the dialogue rules and resolve conflicting matches before continuing.",
    ]) {
      expect(message(new Error(raw))).toBe(raw);
      const rendered = localizeErrorMessage(raw, i18n.t);
      if (locale === "zh-CN") expect(rendered).toMatch(/[\u4e00-\u9fff]/);
    }
  });

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

  it.each(["en", "zh-CN"] as const)("uses source-neutral review and recovery instructions in %s", async (locale) => {
    await changeAppLocale(locale);
    const warning = { id: "cleanup", kind: "ai-cleanup", detail: "Luna API diagnostic", severity: "warning", occurrences: [], availableActions: ["keep"] } satisfies ReviewWarning;
    const messages = [
      i18n.t(reviewGuidance(warning)),
      i18n.t(reviewGuidance({ ...warning, kind: "unknown-warning" })),
      ...["Imported source integrity check failed; re-import the PDF", "Imported source is missing", "Imported document is missing"].map(raw => localizeErrorMessage(message(new Error(raw)), i18n.t)),
    ];
    for (const rendered of messages) {
      expect(rendered).not.toMatch(/PDF|Luna|API/);
      expect(rendered).toMatch(locale === "en" ? /source document/ : /原文/);
    }
  });

  it.each(["en", "zh-CN"] as const)("preserves actionable document import errors in %s", async (locale) => {
    await changeAppLocale(locale);
    for (const raw of ["Save text files as UTF-8 before importing", "Text files must be 20 MiB or smaller", "The document contains no readable text", "Use a PDF, EPUB, TXT, or Markdown file"]) {
      expect(message(new Error(raw))).toBe(raw);
      const rendered = localizeErrorMessage(message(new Error(raw)), i18n.t);
      expect(rendered).not.toMatch(/Something went wrong/);
      if (locale === "zh-CN") expect(rendered).toMatch(/[\u4e00-\u9fff]/);
    }
    expect(message(new Error("Text file contains binary control characters"))).toBe("Save this file as plain UTF-8 text before importing.");
    expect(message(new Error("The EPUB archive is malformed or unsupported"))).toBe("This EPUB could not be read. Try another copy of the book.");
    for (const limit of [20, 64]) {
      const rendered = localizeErrorMessage(message(new Error(`Book exceeds the ${limit} MiB limit`)), i18n.t);
      expect(rendered).toContain(`${limit} MiB`);
      expect(rendered).not.toMatch(/Something went wrong/);
      if (locale === "zh-CN") expect(rendered).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("keeps actionable file and language errors, but does not display raw service exceptions", () => {
    expect(message(new Error("Use a PDF"))).toBe("Use a PDF");
    expect(message(new Error("Select a supported voice language"))).toBe("Select a supported voice language");
    expect(message(new Error("Voice sample must be between 3 and 30 seconds"))).toBe("Voice sample must be between 3 and 30 seconds");
    expect(message(new Error("Imported source integrity check failed; re-import the PDF"))).toBe("Import the source document again before continuing.");
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
    const fallback = "Compare the highlighted text with your source document.";
    expect(userFacingDetail("A word is split across two lines.", fallback)).toBe("A word is split across two lines.");
    expect(userFacingDetail("Luna returned overlapping source offsets", fallback)).toBe(fallback);
  });
});


describe("file-size units", () => {
  it("labels binary measurements explicitly so decimal upload ceilings are unambiguous", () => {
    expect(formatFileSize(1_000_001)).toBe("977 KiB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MiB");
    expect(formatFileSize(1024 ** 3)).toBe("1.0 GiB");
  });
});


it("retranslates an existing import-limit error after changing language", async () => {
  const error = "Choose a file no larger than 99 MB.";
  await changeAppLocale("zh-CN");
  expect(localizeErrorMessage(error, i18n.t)).toBe("请选择不超过 99 MB 的文件。");
  await changeAppLocale("en");
  expect(localizeErrorMessage(error, i18n.t)).toBe(error);
});
