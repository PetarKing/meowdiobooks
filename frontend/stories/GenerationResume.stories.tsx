import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import App from "../src/App";
import type { Job } from "../src/api/contracts";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

function GenerationResume() {
  const appearance = new URLSearchParams(window.location.search).get("appearance") === "dark" ? "dark" : "light";
  const [gateway] = useState(() => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 2);
    snapshot.generatedChapters = [];
    snapshot.recordingScript!.summary.emptyChapterIds = [];
    const job: Job = { id: "resumed-generation", kind: "v2:generate", status: "running", progress: 24,
      payload: { book_id: snapshot.book.id, settings: { chapterIds: [snapshot.chapters[0].id] } } };
    return {
      ...createFixtureGateway("generate-stale"),
      getBookSnapshot: async () => structuredClone(snapshot),
      getJob: async () => structuredClone(job),
      cancelJob: async () => {
        job.status = "canceled";
        job.error = "Audio generation canceled. Your approved work is unchanged.";
        return structuredClone(job);
      },
      processStage: async () => { throw new Error("Reattachment must not submit new work"); },
    };
  });
  return <App gateway={gateway} appearance={appearance} workflowPersistenceNamespace="generation-resume-review"
    initialWorkflowLocation={{ bookId: snapshotFor("generate-stale").book.id, stepId: "generate", activeJobId: "resumed-generation" }} />;
}

const meta = { title: "Workflow/Generation resume", component: GenerationResume } satisfies Meta<typeof GenerationResume>;
export default meta;

export const RunningOneChapter: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: "Making your selected chapters…" });
    await expect(within(dialog).getByText("0 of 1 ready")).toBeVisible();
    await expect(page.getByLabelText("Select Down the Rabbit-Hole")).toBeChecked();
    await expect(page.getByLabelText("Select The Pool of Tears")).not.toBeChecked();
    canvasElement.dataset.scenarioReady = "resumed-one-chapter";
  },
};

export const CanceledRequest: StoryObj<typeof meta> = {
  play: async (context) => {
    await RunningOneChapter.play!(context);
    const page = within(context.canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole("button", { name: "Cancel audio generation" }));
    await waitFor(() => expect(page.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(page.getByRole("checkbox", { name: "Select Down the Rabbit-Hole" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select The Pool of Tears" })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Generate 1 selected →" })).toBeEnabled();
    context.canvasElement.dataset.scenarioReady = "resumed-canceled";
  },
};
