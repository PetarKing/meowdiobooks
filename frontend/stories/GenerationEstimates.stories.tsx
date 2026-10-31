import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import App from "../src/App";
import type { Job } from "../src/api/contracts";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

type ProgressState = "running" | "queued" | "capacity";
function GenerationEstimates({ state }: { state: ProgressState }) {
  const appearance = new URLSearchParams(window.location.search).get("appearance") === "dark" ? "dark" : "light";
  const [gateway] = useState(() => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 3);
    snapshot.generatedChapters = [];
    snapshot.recordingScript!.summary.emptyChapterIds = [];
    const job: Job = {
      id: "estimate-generation", kind: "v2:generate",
      status: state === "queued" ? "queued" : "running",
      progress: state === "running" ? 20 : 1,
      started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      message: state === "running" ? "Rendering chapters: 1 of 3 complete"
        : state === "capacity" ? "Waiting for audio capacity (queue position 2)" : null,
      payload: { book_id: snapshot.book.id, settings: { chapterIds: snapshot.chapters.map((chapter) => chapter.id) } },
    };
    return {
      ...createFixtureGateway("generate-stale"),
      getBookSnapshot: async () => structuredClone(snapshot),
      getJob: async () => structuredClone(job),
      processStage: async () => { throw new Error("Restoring progress must not launch new generation"); },
    };
  });
  return <App gateway={gateway} appearance={appearance} workflowPersistenceNamespace={`generation-estimate-${state}`}
    initialWorkflowLocation={{ bookId: snapshotFor("generate-stale").book.id, stepId: "generate", activeJobId: "estimate-generation" }} />;
}

const meta = { title: "Workflow/Generation estimates", component: GenerationEstimates } satisfies Meta<typeof GenerationEstimates>;
export default meta;
type Story = StoryObj<typeof meta>;
function progressStory(state: ProgressState, expected: string): Story {
  return {
    args: { state },
    play: async ({ canvasElement }) => {
      const page = within(canvasElement.ownerDocument.body);
      const dialog = await page.findByRole("dialog", { name: "Making your selected chapters…" });
      await expect(within(dialog).getByText("Estimated time left")).toBeVisible();
      await expect(within(dialog).getByText(expected)).toBeVisible();
      await expect(within(dialog).getByText(`${state === "running" ? 1 : 0} of 3 recorded`)).toBeVisible();
      await expect(within(dialog).getByText("Estimates update with progress and may change.")).toBeVisible();
      if (state !== "running") await expect(dialog).not.toHaveTextContent("≈");
      canvasElement.dataset.scenarioReady = `estimate-${state}`;
    },
  };
}
export const Running = progressStory("running", "≈ 40 min");
export const Queued = progressStory("queued", "Waiting to start");
export const WaitingForCapacity = progressStory("capacity", "Waiting for audio capacity");
