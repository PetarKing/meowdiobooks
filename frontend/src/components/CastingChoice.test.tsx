import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CastingPreview, WorkflowGateway, WizardSnapshot } from "../api/contracts";
import { CastingChoice } from "./CastingChoice";

const preview: CastingPreview = {
  sources: [{ bookId: "one", title: "The first book", voiceCount: 5 }, { bookId: "two", title: "The second book", voiceCount: 4 }],
  exactMatchCount: 3, totalVoiceCount: 7, remainingVoiceCount: 4, currency: "EUR",
  options: [{ modelId: "studio", label: "Studio", description: "Minor characters may share voices.", estimatedCostMinor: 175 }, { modelId: "balanced", label: "Balanced", description: "A distinct voice for each character.", estimatedCostMinor: 85 }],
};
function Harness({ fetchPreview = vi.fn().mockResolvedValue(preview), models, showVoiceModelControls = true, initialModel = "studio" }: { showVoiceModelControls?: boolean; initialModel?: string; fetchPreview?: ReturnType<typeof vi.fn>; models?: WizardSnapshot["voiceModels"] } = {}) {
  const [gateway] = useState({ previewCasting: fetchPreview } as unknown as WorkflowGateway);
  const [ids, setIds] = useState<string[]>([]);
  const [model, setModel] = useState(initialModel);
  const [ready, setReady] = useState(false);
  return <><CastingChoice showVoiceModelControls={showVoiceModelControls} gateway={gateway} bookId="current" models={models} settings={{ sourceBookIds: ids, voiceModel: model, language: "english" }} onSourcesChange={setIds} onModelChange={setModel} onReadyChange={setReady} /><button disabled={!ready}>Continue</button><output>{JSON.stringify(ids)}</output></>;
}

describe("CastingChoice", () => {
  it("keeps the selected model and reuse choices without exposing model labels or descriptions", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} showVoiceModelControls={false} initialModel="balanced" models={[
      { id: "studio", label: "Studio", supportedLanguages: ["english"] },
      { id: "balanced", label: "Balanced", supportedLanguages: ["english"] },
    ]} />);
    expect(screen.queryByText("Studio")).not.toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getByText("≈ €0.85")).toBeInTheDocument();
    expect(screen.queryByText("A distinct voice for each character.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reuse voices/ }));
    expect(screen.queryByRole("group", { name: "Casting for new voices" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: ["one"], voiceModel: "balanced" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Create new voices/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: [], voiceModel: "balanced" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Reuse voices/ }));
    expect(screen.getByRole("checkbox", { name: /The first book/ })).toBeChecked();
    expect(screen.queryByText("Studio")).not.toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
  });

  it("does not expose technical details from a validation failure", async () => {
    const fetchPreview = vi.fn().mockRejectedValue(Object.assign(new Error("Qwen API 422: invalid JSON characterId"), { status: 422 }));
    render(<Harness fetchPreview={fetchPreview} showVoiceModelControls={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(/Qwen|API|JSON|characterId/);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it.each([422, 500])("shows actionable validation detail only for a %i rejection", async (status) => {
    const fetchPreview = vi.fn().mockRejectedValue(Object.assign(new Error("Select a supported voice language"), { status }));
    render(<Harness fetchPreview={fetchPreview} />);
    const alert = await screen.findByRole("alert");
    if (status === 422) expect(alert).toHaveTextContent("Select a supported voice language");
    else expect(alert).not.toHaveTextContent("Select a supported voice language");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
  it("collapses only for reuse and restores cards and saved selections", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(preview);
    const { container } = render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("button", { name: /Studio/ }));
    expect(container.querySelector(".reuse-open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reuse voices/ }));
    expect(container.querySelector(".reuse-open")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Balanced/ })[0]);
    expect(container.querySelector(".reuse-open")).toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: [], voiceModel: "balanced" })));
    fireEvent.click(screen.getByRole("button", { name: /Reuse voices/ }));
    expect(screen.getByRole("checkbox", { name: /The first book/ })).toBeChecked();
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: ["one"] })));
  });
  it("shows a scrollable library without search", async () => {
    render(<Harness fetchPreview={vi.fn().mockResolvedValue({ ...preview, sources: Array.from({ length: 30 }, (_, index) => ({ bookId: String(index), title: `Volume ${index + 1}`, voiceCount: 4 })) })} />);
    fireEvent.click(await screen.findByRole("button", { name: /Reuse voices/ }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(30);
    expect(screen.getByRole("region", { name: "Books with reusable voices" })).toHaveClass("casting-books");
  });
  it("shows customer prices and only exact matches before proceeding", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: /Reuse voices/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    expect(await screen.findByText("3 exact matches")).toBeInTheDocument();
    expect(screen.getAllByText("≈ €1.75")).toHaveLength(1);
    expect(screen.getByText("≈ €1.75").closest("button")).toBeNull();
    expect(screen.getByText("Up to 4 new voices")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ AI matches/)).not.toBeInTheDocument();
    expect(screen.getByText("AI checks for more matches when you continue.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
  it("toggles books without reordering controls or moving rows", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("button", { name: /Reuse voices/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: ["one", "two"] })));
    expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName(/The first book/);
    expect(screen.queryByRole("button", { name: /Move .* up/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: ["one"] })));
  });
  it("hides reuse when there are no eligible books", async () => {
    render(<Harness fetchPreview={vi.fn().mockResolvedValue({ ...preview, sources: [] })} />);
    await screen.findByText("Studio");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("blocks proceeding on preview failure and supports retry", async () => {
    const fetchPreview = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
  it("keeps catalog choices usable when the first quote fails", async () => {
    const fetchPreview = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} models={[
      { id: "studio", label: "Studio", supportedLanguages: ["english"] },
      { id: "balanced", label: "Balanced", supportedLanguages: ["english"] },
    ]} />);
    expect(screen.getByRole("button", { name: /Balanced/ })).toBeEnabled();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Balanced/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ voiceModel: "balanced" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
  it("does not reuse a cached quote while retrying the same settings", async () => {
    let resolveRetry!: (value: CastingPreview) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error("source quote unavailable"))
      .mockRejectedValueOnce(new Error("quote unavailable"))
      .mockImplementationOnce(() => new Promise<CastingPreview>((resolve) => { resolveRetry = resolve; }));
    render(<Harness fetchPreview={fetchPreview} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Reuse voices/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await screen.findByRole("alert");
    // Returning to Studio restores the settings associated with the first quote.
    fireEvent.click(screen.getAllByRole("button", { name: /Studio/ })[0]);
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(3));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(4));
    expect(screen.getByText("Calculating…")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    resolveRetry({ ...preview, fingerprint: "fresh-after-retry" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
  it.each([undefined, -1, Number.NaN])("blocks generation without a usable estimate (%s)", async (cost) => {
    render(<Harness fetchPreview={vi.fn().mockResolvedValue({ ...preview, options: [{ ...preview.options![0], estimatedCostMinor: cost }] })} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
  it("blocks generation if the selected model is no longer available", async () => {
    render(<Harness fetchPreview={vi.fn().mockResolvedValue({ ...preview, options: [preview.options![1]] })} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Balanced/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
  it("discards old previews after source changes", async () => {
    let resolveOld!: (value: CastingPreview) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(preview).mockImplementationOnce(() => new Promise<CastingPreview>((resolve) => { resolveOld = resolve; })).mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("button", { name: /Reuse voices/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    resolveOld({ ...preview, exactMatchCount: 99 });
    await waitFor(() => expect(screen.getByText("3 exact matches")).toBeInTheDocument());
    expect(screen.queryByText("99 exact matches")).not.toBeInTheDocument();
  });
  it("ignores a superseded failure after the newest quote succeeds", async () => {
    let rejectOld!: (error: Error) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(preview)
      .mockImplementationOnce(() => new Promise<CastingPreview>((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("button", { name: /Reuse voices/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    rejectOld(new Error("old request failed"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
