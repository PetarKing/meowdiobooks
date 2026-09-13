import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CastingPreview, WorkflowGateway } from "../api/contracts";
import { CastingChoice } from "./CastingChoice";

const preview: CastingPreview = {
  sources: [{ bookId: "one", title: "The first book", voiceCount: 5 }, { bookId: "two", title: "The second book", voiceCount: 4 }],
  exactMatchCount: 3, totalVoiceCount: 7, remainingVoiceCount: 4, currency: "EUR",
  options: [{ modelId: "studio", label: "Studio", description: "Minor characters may share voices.", estimatedCostMinor: 175 }, { modelId: "balanced", label: "Balanced", description: "A distinct voice for each character.", estimatedCostMinor: 85 }],
};
function Harness({ fetchPreview = vi.fn().mockResolvedValue(preview) }: { fetchPreview?: ReturnType<typeof vi.fn> } = {}) {
  const [gateway] = useState({ previewCasting: fetchPreview } as unknown as WorkflowGateway);
  const [ids, setIds] = useState<string[]>([]);
  const [model, setModel] = useState("studio");
  const [ready, setReady] = useState(false);
  return <><CastingChoice gateway={gateway} bookId="current" settings={{ sourceBookIds: ids, voiceModel: model, language: "english" }} onSourcesChange={setIds} onModelChange={setModel} onReadyChange={setReady} /><button disabled={!ready}>Continue</button><output>{JSON.stringify(ids)}</output></>;
}

describe("CastingChoice", () => {
  it("starts reuse off and clears selected books when switched off", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    fireEvent.click(toggle);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: [] })));
  });
  it("searches a large library without hiding or losing selected priority", async () => {
    render(<Harness fetchPreview={vi.fn().mockResolvedValue({ ...preview, sources: Array.from({ length: 30 }, (_, index) => ({ bookId: String(index), title: `Volume ${index + 1}`, voiceCount: 4 })) })} />);
    fireEvent.click(await screen.findByRole("switch"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Volume 1$/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search books" }), { target: { value: "Volume 25" } });
    expect(screen.getByRole("checkbox", { name: /Volume 1$/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Volume 25$/ })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: /Volume 25$/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("2 selected · 30 books")).toBeInTheDocument();
  });
  it("shows customer prices and only exact matches before proceeding", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("switch", { name: "Reuse voices from other books" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    expect(await screen.findByText("3 exact matches")).toBeInTheDocument();
    expect(screen.getByText("≈ €1.75")).toBeInTheDocument();
    expect(screen.getByText("Up to 4 new voices")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ AI matches/)).not.toBeInTheDocument();
    expect(screen.getByText("Top book wins. AI checks other names when you continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("toggles books and changes source priority", async () => {
    const fetchPreview = vi.fn().mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Reuse voices from other books" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move The second book up" }));
    await waitFor(() => expect(fetchPreview).toHaveBeenLastCalledWith("current", expect.objectContaining({ sourceBookIds: ["two", "one"] })));
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
  it("discards old previews after source changes", async () => {
    let resolveOld!: (value: CastingPreview) => void;
    const fetchPreview = vi.fn().mockResolvedValueOnce(preview).mockImplementationOnce(() => new Promise<CastingPreview>((resolve) => { resolveOld = resolve; })).mockResolvedValue(preview);
    render(<Harness fetchPreview={fetchPreview} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Reuse voices from other books" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /The first book/ }));
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("checkbox", { name: /The second book/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    resolveOld({ ...preview, exactMatchCount: 99 });
    await waitFor(() => expect(screen.getByText("3 exact matches")).toBeInTheDocument());
    expect(screen.queryByText("99 exact matches")).not.toBeInTheDocument();
  });
});
