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

async function openVoiceDesign(fetchPreview: NonNullable<WorkflowGateway["previewCasting"]>, showVoiceModelControls = true) {
  const snapshot: WizardSnapshot = {
    ...snapshotFor("cast-identities"),
    book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
    activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
    cast: { revision: "cast-draft", phase: "identity-review", dossiers: [], proposals: [], voiceModel: "qwen", language: "english" },
    voiceModels: [{ id: "other", label: "Other provider", supportedLanguages: ["english"] }, { id: "qwen", label: "Studio", supportedLanguages: ["english", "french"] }],
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
  render(<App gateway={gateway} capabilities={{ showVoiceModelControls }} />);
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

  it("hides provider choices in enhanced casting while retaining the restored model and its quote", async () => {
    const fetchPreview = vi.fn().mockResolvedValue({ ...quote, options: [
      { modelId: "other", label: "Other provider", description: "Technical provider details", estimatedCostMinor: 100 },
      ...quote.options!,
    ] });
    const { processStage } = await openVoiceDesign(fetchPreview, false);
    await screen.findByText("≈ €2.94");
    expect(screen.queryByRole("button", { name: /Create new voices|Reuse voices/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Studio|Other provider|Technical provider details|Designed voices/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Voice model" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "english" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      voiceModel: "qwen", language: "english", castingPreviewFingerprint: "english-quote",
    })));
  });

  it.each([true, false])("lets a user refresh unavailable voice options without revealing providers (enhanced: %s)", async (enhanced) => {
    const snapshot: WizardSnapshot = {
      ...snapshotFor("cast-identities"),
      book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
      activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
      cast: { revision: "cast-draft", phase: "identity-review", dossiers: [], proposals: [] },
      voiceModels: [
        { id: "first", label: "First provider", supportedLanguages: ["french"] },
        { id: "host-default", label: "Preferred provider", supportedLanguages: ["english"] },
      ],
      voiceSelection: { modelId: "host-default", language: "english" },
      recoverableStages: { cast: { attempt: 1, message: "Saved", proposalRevision: "cast-draft", modelId: "retired-provider", language: "english" } },
      castingPreviewAvailable: enhanced,
    };
    const processStage = vi.fn().mockResolvedValue({ id: "cast-job", status: "failed", error: "Synthetic stop after submission" });
    const previewCasting = vi.fn().mockResolvedValue({ ...quote, options: [
      { modelId: "first", label: "First provider", description: "Provider details", estimatedCostMinor: 100 },
      { modelId: "host-default", label: "Preferred provider", description: "Other provider details", estimatedCostMinor: 294 },
    ] });
    const gateway = { ...createFixtureGateway("cast-identities"), getBookSnapshot: vi.fn().mockResolvedValue(snapshot), previewCasting, processStage };
    render(<App gateway={gateway} capabilities={{ showVoiceModelControls: false }} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    const refresh = await screen.findByRole("button", { name: "Refresh voice options" });
    expect(processStage).not.toHaveBeenCalled();
    if (enhanced) {
      await screen.findByRole("alert");
      expect(previewCasting).toHaveBeenCalledWith(fixtureBook.id, expect.objectContaining({ voiceModel: "retired-provider" }));
    }
    expect(screen.getByRole("button", { name: "Continue voice generation →" })).toBeDisabled();
    expect(screen.queryByText(/First provider|Preferred provider|Provider details|Other provider details|retired-provider/)).not.toBeInTheDocument();
    fireEvent.click(refresh);
    expect(screen.queryByRole("button", { name: "Refresh voice options" })).not.toBeInTheDocument();
    if (enhanced) {
      fireEvent.change(screen.getByRole("combobox", { name: "Narration language" }), { target: { value: "english" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled());
      expect(previewCasting).toHaveBeenLastCalledWith(fixtureBook.id, expect.objectContaining({ voiceModel: "host-default" }));
    }
    const continueButton = screen.getByRole("button", { name: enhanced ? "Continue →" : "Generate required auditions →" });
    expect(continueButton).toBeEnabled();
    expect(screen.queryByText(/First provider|Preferred provider|Provider details|Other provider details/)).not.toBeInTheDocument();
    fireEvent.click(continueButton);
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({ voiceModel: "host-default", language: "english" })));
  });

  it("hides model details from an accepted cast", async () => {
    const snapshot = snapshotFor("cast-accepted");
    const gateway = { ...createFixtureGateway("cast-accepted"), getBookSnapshot: vi.fn().mockResolvedValue({
      ...snapshot,
      voiceModels: [{ id: "private-model-id", label: "Private provider model", supportedLanguages: ["english"] }],
      voiceSelection: { modelId: "private-model-id", language: "english" },
    }) };
    render(<App gateway={gateway} capabilities={{ showVoiceModelControls: false }} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    await screen.findByRole("heading", { name: "Cast and voices ready" });
    expect(screen.queryByText(/Voice model|Private provider model|private-model-id/)).not.toBeInTheDocument();
    expect(screen.getByText("Assigned voices")).toBeInTheDocument();
    expect(screen.getByText("Audition language")).toBeInTheDocument();
  });

  it("hides the fallback picker and submits the recovered model without replacing it", async () => {
    const snapshot: WizardSnapshot = {
      ...snapshotFor("cast-identities"),
      book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
      activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
      cast: { revision: "cast-draft", phase: "identity-review", dossiers: [], proposals: [] },
      voiceModels: [
        { id: "first", label: "First provider", supportedLanguages: ["english"] },
        { id: "saved", label: "Saved provider", supportedLanguages: ["english"] },
      ],
      voiceSelection: { modelId: "first", language: "english" },
      recoverableStages: { cast: { attempt: 1, message: "Saved", proposalRevision: "cast-draft", modelId: "saved", language: "english" } },
      castingPreviewAvailable: false,
    };
    const processStage = vi.fn().mockResolvedValue({ id: "cast-job", status: "failed", error: "Synthetic stop after submission" });
    const gateway = { ...createFixtureGateway("cast-identities"), getBookSnapshot: vi.fn().mockResolvedValue(snapshot), processStage };
    render(<App gateway={gateway} capabilities={{ showVoiceModelControls: false }} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    const continueButton = await screen.findByRole("button", { name: "Continue voice generation →" });
    expect(screen.queryByRole("combobox", { name: "Voice model" })).not.toBeInTheDocument();
    expect(screen.queryByText(/First provider|Saved provider/)).not.toBeInTheDocument();
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({ voiceModel: "saved", language: "english" })));
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
