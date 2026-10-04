import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { CastingPreview, WizardSnapshot, WorkflowGateway } from "../api/contracts";
import { createFixtureGateway, fixtureBook, snapshotFor } from "../../design-kit/fixtures";

const quote: CastingPreview = {
  sources: [], fingerprint: "english-quote", exactMatchCount: 0,
  totalVoiceCount: 1, remainingVoiceCount: 1, currency: "EUR",
  options: [{ modelId: "qwen", label: "Studio", description: "Designed voices", estimatedCostMinor: 294 }],
};

async function openVoiceDesign(fetchPreview: NonNullable<WorkflowGateway["previewCasting"]>) {
  const snapshot: WizardSnapshot = {
    ...snapshotFor("cast-identities"),
    book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
    activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
    cast: { revision: "cast-draft", phase: "identity-review", dossiers: [], proposals: [], voiceModel: "qwen", language: "english" },
    voiceModels: [{ id: "qwen", label: "Studio", supportedLanguages: ["english", "french"] }],
    voiceSelection: { modelId: "qwen", language: "english" },
    castingPreviewAvailable: true,
  };
  const processStage = vi.fn().mockResolvedValue({ id: "cast-job", status: "failed", error: "Synthetic stop after submission" });
  const gateway = {
    ...createFixtureGateway("cast-identities"),
    getBookSnapshot: vi.fn().mockResolvedValue(snapshot),
    previewCasting: fetchPreview,
    processStage,
  };
  render(<App gateway={gateway} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alice.*Continue/ }));
  const navigation = await screen.findByRole("navigation", { name: "Wizard stages" });
  fireEvent.click(within(navigation).getByText("Cast & voices"));
  fireEvent.click(await screen.findByRole("button", { name: "Design the voices →" }));
  expect(screen.getByRole("combobox", { name: "Narration language" })).toHaveValue("");
  return { processStage };
}

describe("Voice design language confirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the settled quote valid when the user confirms its default language", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(quote);
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByText("≈ €2.94");
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "english" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      language: "english", castingPreviewFingerprint: "english-quote",
    })));
  });

  it("waits for the first quote when the default is confirmed before it loads", async () => {
    let finish!: (preview: CastingPreview) => void;
    const fetchPreview = vi.fn(() => new Promise<CastingPreview>((resolve) => { finish = resolve; }));
    await openVoiceDesign(fetchPreview);
    fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "english" } });
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    finish(quote);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
  });

  it("requires a fresh matching quote after changing the language", async () => {
    let finish!: (preview: CastingPreview) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(quote)
      .mockImplementationOnce(() => new Promise<CastingPreview>((resolve) => { finish = resolve; }));
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByText("≈ €2.94");
    fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "french" } });
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith(fixtureBook.id, expect.objectContaining({ language: "french" })));
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    expect(processStage).not.toHaveBeenCalled();
    finish({ ...quote, fingerprint: "french-quote" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      language: "french", castingPreviewFingerprint: "french-quote",
    })));
  });

  it("does not authorize a failed quote by confirming the default, and recovers on retry", async () => {
    const fetchPreview = vi.fn().mockRejectedValueOnce(new Error("Quote unavailable")).mockResolvedValue(quote);
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "english" } });
    expect(screen.getByRole("button", { name: "Continue →" })).toBeDisabled();
    expect(processStage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
    expect(fetchPreview).toHaveBeenCalledTimes(2);
  });
});
