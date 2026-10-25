import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway } from "../design-kit/fixtures";
import { cleanupWarning, consolidatedCleanupWarning } from "../design-kit/cleanupFixture";
import { enterScenario } from "./enterScenario";

function CleanupReview({ consolidated = false, many = false }: { consolidated?: boolean; many?: boolean }) {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      const warning = consolidated ? consolidatedCleanupWarning : many ? { ...cleanupWarning, occurrences: Array.from({ length: 150 }, (_, i) => ({ ...cleanupWarning.occurrences[0], id: `ai-${i}`, source: `Source fragment ${i}`, replacement: `Corrected fragment ${i}` })) } : cleanupWarning;
      return stage === "review" ? Object.assign(candidate, { warnings: [{ ...warning }, ...(consolidated ? [{ id: "front-matter", kind: "front-back-matter", severity: "warning", availableActions: ["keep", "exclude"], occurrences: [{ id: "author-note", source: "About the author", text: "About the author", page: 4 }] }] : [])], boundaryCandidates: [] }) : candidate;
    };
    return fixture;
  }, [consolidated, many]);
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
    await userEvent.click(canvas.getByRole("button", { name: /^Apply all suggested choices/ }));
    await expect(canvas.getByText("No correction was proposed. Check the source before keeping or leaving out this text.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
export const KeptChoiceIsPreservedByBulk: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Keep Keep the original/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^Apply all suggested choices/ }));
    await expect(canvas.getByRole("button", { name: /^Apply all suggested choices/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await expect(canvas.getByRole("button", { name: /^Keep Keep the original/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: /^Leave This highlighted/ }));
    await expect(canvas.getByRole("button", { name: /^Apply all suggested choices/ })).toBeDisabled();
  },
};
export const ConsolidatedSourceWarning: Story = {
  args: { consolidated: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("A strange fragment.")).toBeVisible();
    await expect(canvas.queryByText("broken")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /Try extraction again/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /3 AI suggestions.*2 occurrences/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /3 AI suggestions.*2 occurrences/ }));
    await expect(canvas.getByText("broken")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^Apply all suggested choices/ }));
    await expect(canvas.getByRole("button", { name: /^Apply all suggested choices/ })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
export const ManySuggestions: Story = {
  args: { many: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Example 1 of 150")).toBeVisible();
    await expect(canvas.queryByText("Corrected fragment 149")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /^Apply all suggested choices/ }));
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: /^Keep Keep the original/ }));
    await expect(canvas.getByRole("button", { name: /^Apply all suggested choices/ })).toBeDisabled();
  },
};
