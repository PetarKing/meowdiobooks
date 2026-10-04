import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureGateway, snapshotFor } from "../../design-kit/fixtures";
import type { WizardSnapshot } from "../api/contracts";
import type { GenerationPurchasePresentation } from "../app/contracts";
import { publicGenerationEstimatePolicy } from "../workflow/generation";
import { GeneratePage, type GeneratePageModel } from "./GeneratePage";

function Tracklist({ generate = vi.fn(), exportChapters = vi.fn(), snapshot = snapshotFor("generate-stale"), purchase, initialSelection = [], initialFilter = "pending" }: {
  generate?: GeneratePageModel["generateChapters"];
  exportChapters?: GeneratePageModel["continueToExport"];
  snapshot?: WizardSnapshot;
  purchase?: GenerationPurchasePresentation;
  initialFilter?: GeneratePageModel["chapterFilter"];
  initialSelection?: string[];

}) {
  const { t } = useTranslation();
  const [selectedChapters, setSelectedChapters] = useState<string[]>(initialSelection);
  const [chapterFilter, setChapterFilter] = useState<GeneratePageModel["chapterFilter"]>(initialFilter);
  const [listeningChapterId, setListeningChapterId] = useState<string>();
  const [splitChapterId, setSplitChapterId] = useState<string>();
  return <GeneratePage model={{
    gateway: createFixtureGateway("generate-stale"), book: snapshot.book, snapshot,
    busy: false, error: "", chapterFilter, selectedChapters, listeningChapterId, splitChapterId,
    setChapterFilter, setSelectedChapters, setListeningChapterId, setSplitChapterId,
    generateChapters: generate, splitLongChapter: vi.fn(), continueToExport: exportChapters,
    generationSamples: [], generationEstimatePolicy: publicGenerationEstimatePolicy, t,
  }} purchase={purchase} />;
}

function purchasedScope(snapshot: WizardSnapshot): GenerationPurchasePresentation {
  return {
    bookId: snapshot.book.id,
    extractionRevision: snapshot.activeArtifacts.extraction!,
    dialogueRevision: snapshot.activeArtifacts.dialogue!,
    reviewRevision: snapshot.activeArtifacts.review!,
    castRevision: snapshot.activeArtifacts.cast!,
    scriptRevision: snapshot.recordingScript?.revision ?? null,
    chapterIds: snapshot.chapters.map((chapter) => chapter.id),
  };
}

describe("Generate chapter targets", () => {
  it("defers resize-observer writes and cancels queued dock layout work on unmount", () => {
    let resize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const { unmount } = render(<Tracklist />);
      const anchor = document.querySelector<HTMLElement>(".generation-selection-anchor")!;
      const height = anchor.style.height;
      resize();
      resize();
      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(anchor.style.height).toBe(height);
      unmount();
      expect(cancelFrame).toHaveBeenCalledWith(7);
      expect(anchor.style.height).toBe("");
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("normalizes the former All filter to To make, keeps empty rows visible, and uses disjoint audio-ready tabs", () => {
    render(<Tracklist initialFilter="all" />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: /^All/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "To make 3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select Pig and Pepper" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Listen to Down the Rabbit-Hole (older recording)" })).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "Select The Pool of Tears" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Generated 2" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText("Older recording")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Pig and Pepper" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select The Pool of Tears" })).not.toBeChecked();
  });

  it("does not infer purchase from playable or older audio", () => {
    render(<Tracklist />);
    expect(screen.queryByText("Generated", { selector: ".track-status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^All/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Older recording").length).toBeGreaterThan(0);
    expect(document.querySelector(".chapter-card.purchased")).toBeNull();
    expect(screen.queryByText("Purchased")).not.toBeInTheDocument();
  });

  it("marks only host-confirmed available chapters without changing audio state or selection", () => {
    const snapshot = snapshotFor("generate-stale");
    const purchase = purchasedScope(snapshot);
    purchase.chapterIds = [snapshot.chapters[0].id, snapshot.chapters[5].id];
    const generate = vi.fn();
    render(<Tracklist snapshot={snapshot} purchase={purchase} generate={generate} />);
    const chapter = screen.getByRole("heading", { name: "Down the Rabbit-Hole" }).closest("article")!;
    expect(within(chapter).queryByText("Purchased")).not.toBeInTheDocument();
    expect(chapter).toHaveClass("purchased", "stale");
    expect(within(chapter).getByText("Older recording")).toBeInTheDocument();
    expect(screen.queryByText("Purchased")).not.toBeInTheDocument();
    const checkbox = within(chapter).getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Generate 1 selected →" }));
    expect(generate).toHaveBeenCalledWith([snapshot.chapters[0].id]);
  });

  it("keeps a paid chapter without audio pending and never generates merely from purchase presentation", () => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.generatedChapters = [];
    const generate = vi.fn();
    render(<Tracklist snapshot={snapshot} purchase={purchasedScope(snapshot)} generate={generate} />);
    const chapter = screen.getByRole("heading", { name: "Down the Rabbit-Hole" }).closest("article")!;
    expect(chapter).toHaveClass("purchased");
    expect(chapter).not.toHaveClass("generated");
    expect(within(chapter).getByText("To make")).toBeInTheDocument();
    expect(within(chapter).queryByText("Generated")).not.toBeInTheDocument();
    expect(within(chapter).queryByRole("button", { name: /Listen/ })).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(["bookId", "extractionRevision", "dialogueRevision", "reviewRevision", "castRevision", "scriptRevision"] as const)("hides purchase when the host's %s is stale", (key) => {
    const snapshot = snapshotFor("generate-stale");
    render(<Tracklist snapshot={snapshot} purchase={{ ...purchasedScope(snapshot), [key]: "older-scope" }} />);
    expect(document.querySelector(".chapter-card.purchased")).toBeNull();
  });

  it.each(["missing", "draft"] as const)("hides purchase with a %s cast", (state) => {
    const snapshot = snapshotFor("generate-stale");
    const purchase = purchasedScope(snapshot);
    if (state === "missing") delete snapshot.cast;
    else snapshot.cast!.phase = "audition-review";
    render(<Tracklist snapshot={snapshot} purchase={purchase} />);
    expect(document.querySelector(".chapter-card.purchased")).toBeNull();
  });

  it("shows completion rather than a pending estimate after the only chapter is ready", () => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 1);
    snapshot.generatedChapters = [{ ...snapshot.generatedChapters![0], current: true }];
    render(<Tracklist snapshot={snapshot} />);
    expect(screen.queryByText("Audio to make")).not.toBeInTheDocument();
    expect(screen.queryByText("Generation")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimate pending")).not.toBeInTheDocument();
    expect(screen.getByText("1 chapter is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Export →" })).toBeEnabled();
  });

  it.each(["all", "pending", "generated"] as const)("keeps a single finished chapter visible and exportable with the saved %s filter", (initialFilter) => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 1);
    snapshot.generatedChapters = [{ ...snapshot.generatedChapters![0], current: true }];
    render(<Tracklist snapshot={snapshot} initialFilter={initialFilter} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Down the Rabbit-Hole" }));
    expect(screen.getByRole("button", { name: "Continue to Export →" })).toHaveClass("primary");
    expect(screen.getByRole("button", { name: "Regenerate 1 selected" })).toHaveClass("ghost");
    expect(within(screen.getByRole("region", { name: "Generation action" })).queryByText("Generation")).not.toBeInTheDocument();
  });

  it.each(["generated"] as const)("exports a selected current recording in a multi-chapter %s view unless regeneration is explicitly chosen", (initialFilter) => {
    const snapshot = snapshotFor("generate-stale");
    const readyId = snapshot.generatedChapters.find((row) => row.current)!.chapterId;
    const title = snapshot.chapters.find((row) => row.id === readyId)!.title;
    const generate = vi.fn();
    const exportChapters = vi.fn();
    render(<Tracklist snapshot={snapshot} initialFilter={initialFilter} generate={generate} exportChapters={exportChapters} />);
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${title}` }));
    const options = screen.getByText("More options").closest("details")!;
    const regenerate = screen.getByRole("button", { name: "Regenerate 1 selected" });
    expect(options).not.toHaveAttribute("open");
    expect(regenerate).not.toBeVisible();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Export →" }));
    expect(exportChapters).toHaveBeenCalledWith([readyId]);
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("More options"));
    expect(regenerate).toBeVisible();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.keyDown(options, { key: "Escape" });
    expect(options).not.toHaveAttribute("open");
    expect(screen.getByText("More options")).toHaveFocus();
    fireEvent.click(screen.getByText("More options"));
    fireEvent.click(regenerate);
    expect(generate).toHaveBeenCalledWith([readyId]);
    expect(options).not.toHaveAttribute("open");
  });

  it("closes regeneration options when selection changes, without dispatching work", () => {
    const snapshot = snapshotFor("generate-stale");
    const generate = vi.fn();
    render(<Tracklist snapshot={snapshot} initialFilter="generated" generate={generate} />);
    const [first, second] = screen.getAllByRole("checkbox");
    fireEvent.click(first);
    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByRole("button", { name: "Regenerate 1 selected" })).toBeVisible();
    fireEvent.click(second);
    expect(screen.getByText("More options").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Regenerate 2 selected" })).not.toBeVisible();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps existing current audio out of mixed generation and its duration estimate", () => {
    const snapshot = snapshotFor("generate-stale");
    const readyId = snapshot.generatedChapters.find((row) => row.current)!.chapterId;
    const pendingId = snapshot.chapters[0].id;
    const generate = vi.fn();
    render(<Tracklist snapshot={snapshot} generate={generate} initialSelection={[pendingId, readyId]} />);
    expect(screen.getByText("1 selected chapter is already generated and will be kept.")).toBeInTheDocument();
    const action = screen.getByRole("region", { name: "Generation action" });
    expect(within(action).queryByText("Listening")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate 1 selected →" }));
    expect(generate).toHaveBeenCalledWith([pendingId]);
  });

  it("keeps a missing duration estimate distinct from no remaining chapters", () => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = [{ ...snapshot.chapters[0], estimatedCharacters: 0 }];
    snapshot.generatedChapters = [];
    snapshot.recordingScript!.summary.chapters[0].estimatedSeconds = 0;
    render(<Tracklist snapshot={snapshot} />);
    expect(screen.getAllByText("Estimate pending").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Down the Rabbit-Hole" })).not.toBeChecked();
    expect(screen.queryByText("None remaining")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select chapters above" })).toBeDisabled();
  });

  it("uses a native label to select and deselect a chapter without a custom row keyboard handler", () => {
    render(<Tracklist />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Down the Rabbit-Hole" });
    const label = checkbox.closest("label")!;
    expect(label).toHaveClass("chapter-row-target");
    fireEvent.click(label);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("button", { name: "Generate 1 selected →" })).toBeEnabled();
    fireEvent.click(label);
    expect(checkbox).not.toBeChecked();
  });

  it("keeps older-recording Listen independent from selection and preserves selection when closing the player", () => {
    render(<Tracklist />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Down the Rabbit-Hole" });
    fireEvent.click(screen.getByRole("button", { name: "Listen to Down the Rabbit-Hole (older recording)" }));
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Close player" }));
    fireEvent.click(checkbox.closest("label")!);
    fireEvent.click(screen.getByRole("button", { name: "Listen to Down the Rabbit-Hole (older recording)" }));
    expect(checkbox).toBeChecked();
    const player = screen.getByRole("dialog", { name: "Down the Rabbit-Hole" });
    expect(within(player).getByText("Older recording")).toBeInTheDocument();
    fireEvent.click(within(player).getByRole("button", { name: "Close player" }));
    expect(checkbox).toBeChecked();
  });

  it("does not select an unavailable chapter through its row or Select all, and filters clear prior selections", () => {
    render(<Tracklist />);
    const unavailable = screen.getByRole("checkbox", { name: "Select Pig and Pepper" });
    expect(unavailable).toBeDisabled();
    fireEvent.click(unavailable.closest("label")!);
    expect(unavailable).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(unavailable).not.toBeChecked();
    expect(screen.getAllByRole("checkbox").filter((checkbox) => (checkbox as HTMLInputElement).checked)).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: /^To make/ }));
    expect(screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Select Pig and Pepper" })).toBeDisabled();
  });
});
