import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App, { type GenerationPurchasePresentation } from "../src/App";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

function GenerationPurchase({ completed = false }: { completed?: boolean }) {
  const queryAppearance = new URLSearchParams(window.location.search).get("appearance");
  const appearance = queryAppearance === "light" || queryAppearance === "dark" ? queryAppearance : undefined;
  const [fixture] = useState(() => {
    const snapshot = snapshotFor("generate-stale");
    if (completed) {
      snapshot.chapters = snapshot.chapters.slice(0, 1);
      snapshot.generatedChapters = [{ ...snapshot.generatedChapters[0], current: true }];
    }
    const purchase: GenerationPurchasePresentation = {
      bookId: snapshot.book.id,
      extractionRevision: snapshot.activeArtifacts.extraction!,
      dialogueRevision: snapshot.activeArtifacts.dialogue!,
      reviewRevision: snapshot.activeArtifacts.review!,
      castRevision: snapshot.activeArtifacts.cast!,
      scriptRevision: snapshot.recordingScript!.revision,
      chapterIds: snapshot.chapters.map((chapter) => chapter.id),
    };
    return {
      gateway: { ...createFixtureGateway("generate-stale"), getBookSnapshot: async () => structuredClone(snapshot) },
      purchase,
    };
  });
  return <App gateway={fixture.gateway} generationPurchase={fixture.purchase} appearance={appearance} />;
}

const meta = { title: "Workflow/Generation purchase", component: GenerationPurchase } satisfies Meta<typeof GenerationPurchase>;
export default meta;

export const PurchasedChapters: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Alice.*Continue/ }));
    await userEvent.click(within(await canvas.findByRole("navigation", { name: "Wizard stages" })).getByText("Generate"));
    await expect(canvasElement.querySelectorAll(".chapter-card.purchased")).toHaveLength(3);
    await expect(canvas.queryByText("Purchased")).not.toBeInTheDocument();
    await expect(canvas.getAllByText("Older recording").length).toBeGreaterThan(0);
    canvasElement.dataset.scenarioReady = "purchased-chapters";
  },
};

export const PurchasedAndComplete: StoryObj<typeof meta> = {
  args: { completed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Alice.*Continue/ }));
    await userEvent.click(within(await canvas.findByRole("navigation", { name: "Wizard stages" })).getByText("Generate"));
    await expect(await canvas.findByText("Generated")).toBeVisible();
    await expect(canvas.queryByText("Purchased")).not.toBeInTheDocument();
    await expect(canvas.getByText("1 chapter is ready")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Continue to Export →" })).toBeEnabled();
    canvasElement.dataset.scenarioReady = "purchased-and-complete";
  },
};
