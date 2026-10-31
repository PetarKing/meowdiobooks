import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

function GenerationCompletion() {
  const [gateway] = useState(() => {
    const snapshot = snapshotFor("generate-stale");
    snapshot.chapters = snapshot.chapters.slice(0, 1);
    snapshot.generatedChapters = [{ ...snapshot.generatedChapters![0], current: true }];
    return {
      ...createFixtureGateway("generate-stale"),
      getBookSnapshot: async () => structuredClone(snapshot),
    };
  });
  return <App gateway={gateway} />;
}

const meta = { title: "Workflow/Generation completion", component: GenerationCompletion } satisfies Meta<typeof GenerationCompletion>;
export default meta;

export const OneChapterReady: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Alice.*Continue/ }));
    const navigation = await canvas.findByRole("navigation", { name: "Wizard stages" });
    await userEvent.click(within(navigation).getByText("Generate"));
    await expect(canvas.queryByText("Audio to make")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tablist", { name: "Filter chapters" })).not.toBeInTheDocument();
    await expect(canvas.getByText("1 chapter is ready")).toBeVisible();
    await expect(canvas.queryByText("Estimate pending")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Continue to Export →" })).toBeEnabled();
  },
};
