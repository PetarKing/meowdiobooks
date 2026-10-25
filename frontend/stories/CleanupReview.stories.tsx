import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway } from "../design-kit/fixtures";
import { cleanupWarning, consolidatedCleanupWarning } from "../design-kit/cleanupFixture";
import { enterScenario } from "./enterScenario";

function CleanupReview({ consolidated = false }: { consolidated?: boolean }) {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === "review" ? Object.assign(candidate, { warnings: [{ ...(consolidated ? consolidatedCleanupWarning : cleanupWarning) }], boundaryCandidates: [] }) : candidate;
    };
    return fixture;
  }, [consolidated]);
  return <App gateway={gateway} />;
}

const meta = { title: "Product/AI cleanup review", component: CleanupReview } satisfies Meta<typeof CleanupReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Proposals: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("broken")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
export const SourceCheckAfterBulkApply: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Apply all corrections" }));
    await expect(canvas.getByText("No correction was proposed. Check the source before keeping this text or trying extraction again.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};

export const KeptChoiceCanBeAppliedByBulk: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Keep original text/ }));
    const queue = within(canvas.getByRole("complementary", { name: "Decision queue" }));
    await userEvent.click(queue.getByRole("button", { name: "Apply all corrections" }));
    await expect(canvas.getByRole("button", { name: "Apply all corrections" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await expect(canvas.getByRole("button", { name: /^Keep original text/ })).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByRole("button", { name: /^Apply correction/ })).toHaveAttribute("aria-pressed", "true");
  },
};

export const ConsolidatedSourceWarning: Story = {
  args: { consolidated: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("broken")).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "AI cleanup" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /^Keep original text/ }));
    await expect(canvas.getByRole("button", { name: /^Keep as is/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Apply all corrections" }));
    await expect(canvas.getByRole("button", { name: "Apply all corrections" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
