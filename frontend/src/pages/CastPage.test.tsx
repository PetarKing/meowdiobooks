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
    getJob: vi.fn(createFixtureGateway("cast-identities").getJob),
  };
  render(<App gateway={gateway} capabilities={{ showVoiceModelControls }} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alice.*Continue/ }));
  const navigation = await screen.findByRole("navigation", { name: "Wizard stages" });
  fireEvent.click(within(navigation).getByText("Cast & voices"));
  fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
  expect(screen.getByRole("combobox", { name: "Narration language" })).toHaveValue("");
  return { processStage, getJob: gateway.getJob };
}

describe("Voice design language confirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("loads automatic prior-book matches on the cast and clears them when language changes", async () => {
    const snapshot = snapshotFor("cast-identities");
    const cast = { ...snapshot.cast!, proposals: snapshot.cast!.proposals.map((row) => ({ ...row, reviewRequired: false })), voiceModel: "qwen", language: "english", previousVoiceMatches: undefined };
    const previewCasting = vi.fn().mockImplementation((_id, settings) => Promise.resolve({
      ...quote, previousVoiceMatches: settings.language === "english" ? { Alice: { bookTitle: "First book" } } : {},
    }));
    const gateway = { ...createFixtureGateway("cast-identities"), previewCasting,
      getBookSnapshot: vi.fn().mockResolvedValue({ ...snapshot, cast, voiceReuseAvailable: true,
        castingPreviewAvailable: false,
        voiceModels: [{ id: "qwen", label: "Local", supportedLanguages: ["english", "french"] }],
        voiceSelection: { modelId: "qwen", language: "english" } }),
    };
    render(<App gateway={gateway} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    await screen.findByText("From prior book");
    expect(previewCasting).toHaveBeenCalledWith(fixtureBook.id, expect.objectContaining({ sourceBookIds: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" }));
    fireEvent.click(screen.getByRole("option", { name: "french" }));
    fireEvent.click(screen.getByRole("button", { name: "← Back to cast" }));
    await waitFor(() => expect(screen.queryByText("From prior book")).not.toBeInTheDocument());
    await waitFor(() => expect(previewCasting).toHaveBeenLastCalledWith(fixtureBook.id, expect.objectContaining({ language: "french" })));
  });

  it("hides provider choices in enhanced casting while retaining the restored model and its quote", async () => {
    const fetchPreview = vi.fn().mockResolvedValue({ ...quote, options: [
      { modelId: "other", label: "Other provider", description: "Technical provider details", estimatedCostMinor: 100 },
      ...quote.options!,
    ] });
    const { processStage } = await openVoiceDesign(fetchPreview, false);
    await screen.findByText("≈ €2.94");
    expect(screen.queryByText("Automatic voice design")).not.toBeInTheDocument();
    expect(screen.queryByText(/Studio|Other provider|Technical provider details|Designed voices/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Voice model" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Generate voices →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      voiceModel: "qwen", language: "english", castingPreviewFingerprint: "english-quote",
    })));
  });

  it("dismisses confirmation as soon as generation is submitted", async () => {
    const { processStage, getJob } = await openVoiceDesign(vi.fn().mockResolvedValue(quote));
    processStage.mockResolvedValue({ id: "cast-job", status: "running", progress: 10, message: "Generating voices" });
    getJob.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" }));
    fireEvent.click(screen.getByRole("option", { name: "english" }));
    const generate = screen.getByRole("button", { name: "Generate voices →" });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    expect(processStage).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Ready for their voices?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Narration language" })).not.toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: "Processing progress" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it.each(["language", "method"])("keeps unchanged auditions and regenerates after changing %s", async (setting) => {
    const base = snapshotFor("cast-identities");
    const snapshot: WizardSnapshot = {
      ...base,
      book: { ...base.book, completedStages: ["import", "extract", "dialogue", "review"] },
      cast: { revision: "voices-1", phase: "audition-review", dossiers: [], proposals: [], voiceModel: "first", language: "english", narrator: { characterId: "narrator", name: "Narrator", voicePreviewRevision: "v1", previewUrl: "/voice.wav" }, identities: [] },
      voiceModels: [{ id: "first", label: "First method", supportedLanguages: ["english", "french"] }, { id: "second", label: "Second method", supportedLanguages: ["english", "french"] }],
      voiceSelection: { modelId: "first", language: "english" },
      castingPreviewAvailable: false,
    };
    const processStage = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<App gateway={{ ...createFixtureGateway("cast-identities"), getBookSnapshot: vi.fn().mockResolvedValue(snapshot), processStage }} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "← Edit cast" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue →" }));
    expect(processStage).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Cast voice auditions" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "← Edit cast" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    if (setting === "language") {
      fireEvent.click(screen.getByRole("combobox", { name: "Narration language" }));
      fireEvent.click(screen.getByRole("option", { name: "french" }));
    } else fireEvent.click(screen.getByRole("button", { name: "Second method" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate voices →" }));
    expect(processStage).toHaveBeenCalledExactlyOnceWith(fixtureBook.id, "cast", expect.objectContaining({ voiceModel: setting === "method" ? "second" : "first", language: setting === "language" ? "french" : "english" }));
    // The loader starts during submission, before the server returns a job.
    expect(screen.getByRole("progressbar", { name: "Processing progress" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Ready for their voices?" })).not.toBeInTheDocument();
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
    if (!enhanced) fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
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
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
    if (enhanced) {
      fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
      expect(previewCasting).toHaveBeenLastCalledWith(fixtureBook.id, expect.objectContaining({ voiceModel: "host-default" }));
    }
    const continueButton = screen.getByRole("button", { name: "Generate voices →" });
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
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    const continueButton = await screen.findByRole("button", { name: "Continue voice generation →" });
    expect(screen.queryByRole("combobox", { name: "Voice model" })).not.toBeInTheDocument();
    expect(screen.queryByText(/First provider|Saved provider/)).not.toBeInTheDocument();
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({ voiceModel: "saved", language: "english" })));
  });

  it("keeps local model and language choices on Back and Cancel without a reuse adapter", async () => {
    const snapshot: WizardSnapshot = {
      ...snapshotFor("cast-identities"),
      book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
      activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
      cast: { revision: "draft", phase: "identity-review", dossiers: [], proposals: [] },
      voiceModels: [{ id: "first", label: "First local method", supportedLanguages: ["english", "french"] }, { id: "second", label: "Second local method", supportedLanguages: ["english", "french"] }],
      voiceSelection: { modelId: "first", language: "english" },
      castingPreviewAvailable: false,
    };
    const processStage = vi.fn();
    const gateway = { ...createFixtureGateway("cast-identities"), getBookSnapshot: vi.fn().mockResolvedValue(snapshot), previewCasting: undefined, processStage };
    render(<App gateway={gateway} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Second local method/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "french" }));
    for (const close of ["← Back to cast", "Cancel voice setup"]) {
      fireEvent.click(screen.getByRole("button", { name: close }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Next →" }));
      expect(screen.getByRole("combobox", { name: "Narration language" })).toHaveValue("french");
      expect(screen.getByRole("button", { name: /Second local method/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled();
    }
    expect(processStage).not.toHaveBeenCalled();
  });

  it.each([true, false])("recovers a saved local method when the only usable choice is a replacement (empty catalog entry: %s)", async (emptyEntry) => {
    const snapshot: WizardSnapshot = {
      ...snapshotFor("cast-identities"),
      book: { ...snapshotFor("cast-identities").book, completedStages: ["import", "extract", "dialogue", "review"] },
      activeArtifacts: { extraction: "e1", dialogue: "d1", review: "r1" },
      cast: { revision: "draft", phase: "identity-review", dossiers: [], proposals: [] },
      voiceModels: [...(emptyEntry ? [{ id: "saved", label: "Unavailable", supportedLanguages: [] }] : []), { id: "replacement", label: "Replacement", supportedLanguages: ["english"] }],
      voiceSelection: { modelId: "replacement", language: "english" },
      recoverableStages: { cast: { attempt: 1, message: "Saved", proposalRevision: "draft", modelId: "saved", language: "english" } },
      castingPreviewAvailable: false,
    };
    const processStage = vi.fn().mockResolvedValue({ id: "cast-job", status: "failed", error: "Synthetic generation failure" });
    const gateway = { ...createFixtureGateway("cast-identities"), getBookSnapshot: vi.fn().mockResolvedValue(snapshot), processStage };
    render(<App gateway={gateway} initialWorkflowLocation={{ bookId: fixtureBook.id, stepId: "cast" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh voice options" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" }));
    fireEvent.click(screen.getByRole("option", { name: "english" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate voices →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({ voiceModel: "replacement", language: "english" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ready for their voices?" })).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong while completing this step.");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByRole("combobox", { name: "Narration language" })).toHaveValue("english");
    expect(screen.getByRole("button", { name: "Continue voice generation →" })).toBeEnabled();
  });

  it("keeps the settled quote valid when the user confirms its default language", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(quote);
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByText("≈ €2.94");
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Generate voices →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      language: "english", castingPreviewFingerprint: "english-quote",
    })));
  });

  it("waits for the first quote when the default is confirmed before it loads", async () => {
    let finish!: (preview: CastingPreview) => void;
    const fetchPreview = vi.fn(() => new Promise<CastingPreview>((resolve) => { finish = resolve; }));
    await openVoiceDesign(fetchPreview);
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    finish(quote);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
  });

  it("requires a fresh matching quote after changing the language", async () => {
    let finish!: (preview: CastingPreview) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(quote)
      .mockImplementationOnce(() => new Promise<CastingPreview>((resolve) => { finish = resolve; }));
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByText("≈ €2.94");
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "french" }));
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith(fixtureBook.id, expect.objectContaining({ language: "french" })));
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    expect(processStage).not.toHaveBeenCalled();
    finish({ ...quote, fingerprint: "french-quote" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Generate voices →" }));
    await waitFor(() => expect(processStage).toHaveBeenCalledWith(fixtureBook.id, "cast", expect.objectContaining({
      language: "french", castingPreviewFingerprint: "french-quote",
    })));
  });

  it("does not authorize a failed quote by confirming the default, and recovers on retry", async () => {
    const fetchPreview = vi.fn().mockRejectedValueOnce(new Error("Quote unavailable")).mockResolvedValue(quote);
    const { processStage } = await openVoiceDesign(fetchPreview);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("combobox", { name: "Narration language" })); fireEvent.click(screen.getByRole("option", { name: "english" }));
    expect(screen.getByRole("button", { name: "Generate voices →" })).toBeDisabled();
    expect(processStage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    expect(fetchPreview).toHaveBeenCalledTimes(2);
  });
});
