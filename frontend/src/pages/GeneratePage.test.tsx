import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureGateway, snapshotFor } from "../../design-kit/fixtures";
import type { WizardSnapshot } from "../api/contracts";
import { publicGenerationEstimatePolicy } from "../workflow/generation";
import { GeneratePage, type GeneratePageModel } from "./GeneratePage";

function Tracklist({ generate = vi.fn(), snapshot = snapshotFor("generate-stale") }: {
  generate?: GeneratePageModel["generateChapters"];
  snapshot?: WizardSnapshot;
}) {
  const { t } = useTranslation();
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [chapterFilter, setChapterFilter] = useState<GeneratePageModel["chapterFilter"]>("all");
  const [listeningChapterId, setListeningChapterId] = useState<string>();
  const [splitChapterId, setSplitChapterId] = useState<string>();
  return <GeneratePage model={{
    gateway: createFixtureGateway("generate-stale"), book: snapshot.book, snapshot,
    busy: false, error: "", chapterFilter, selectedChapters, listeningChapterId, splitChapterId,
    setChapterFilter, setSelectedChapters, setListeningChapterId, setSplitChapterId,
    generateChapters: generate, splitLongChapter: vi.fn(), continueToExport: vi.fn(),
    generationSamples: [], generationEstimatePolicy: publicGenerationEstimatePolicy, t,
  }} />;
}

describe("Generate chapter targets", () => {
  it("shows completion rather than a pending estimate after the only chapter is ready", () => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 1);
    snapshot.generatedChapters = [{ ...snapshot.generatedChapters![0], current: true }];
    render(<Tracklist snapshot={snapshot} />);
    expect(within(screen.getByText("Audio to make").parentElement!).getByText("None remaining")).toBeInTheDocument();
    expect(screen.queryByText("Estimate pending")).not.toBeInTheDocument();
    expect(screen.getByText("1 chapter is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Export →" })).toBeEnabled();
  });

  it("keeps a missing duration estimate distinct from no remaining chapters", () => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = [{ ...snapshot.chapters[0], estimatedCharacters: 0 }];
    snapshot.generatedChapters = [];
    snapshot.recordingScript!.summary.chapters[0].estimatedSeconds = 0;
    render(<Tracklist snapshot={snapshot} />);
    expect(within(screen.getByText("Audio to make").parentElement!).getByText("Estimate pending")).toBeInTheDocument();
    expect(screen.getByText("Still to make").parentElement).toHaveTextContent("1 chapter");
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
    expect(screen.getAllByRole("checkbox").filter((checkbox) => (checkbox as HTMLInputElement).checked)).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: /^To make/ }));
    expect(screen.getAllByRole("checkbox").every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Select Pig and Pepper" })).not.toBeInTheDocument();
  });
});
