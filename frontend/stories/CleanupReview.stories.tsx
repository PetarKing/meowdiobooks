import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway } from "../design-kit/fixtures";
import { cleanupWarning, consolidatedCleanupWarning } from "../design-kit/cleanupFixture";
import { enterScenario } from "./enterScenario";

function CleanupReview({ consolidated = false, many = false, boundaries = false, sourceChecks = 0, onlySourceChecks = false }: { consolidated?: boolean; many?: boolean; boundaries?: boolean; sourceChecks?: number; onlySourceChecks?: boolean }) {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      const boundaryRows = cleanupWarning.occurrences.map((row, i) => ({ ...row,
        source: "her", text: "her", replacement: i === 2 ? undefined : "her eyes",
        availableActions: i === 2 ? ["keep"] : ["keep", "repair"],
        boundaryDecision: i === 2 ? "UNSURE" : "SPACE",
        proposalStatus: i === 2 ? "source_review" : "proposed",
        boundarySource: "hereyes",
        boundaryAnchors: [
          { blockId: `left-${i}`, spanId: `left-span-${i}`, sourceStart: 0, sourceEnd: 3, source: "her", page: 1 },
          { blockId: `right-${i}`, spanId: `right-span-${i}`, sourceStart: 0, sourceEnd: 4, source: "eyes", page: 2 },
        ],
      }));
      const preservedRows = Array.from({ length: sourceChecks }, (_, i) => ({ ...boundaryRows[2], id: `source-check-${i}`, boundarySource: `Page join ${i + 1}: she turned the page.` }));
      const corrections = Array.from({ length: 4 }, (_, i) => ({ ...cleanupWarning.occurrences[0], id: `correction-${i}` }));
      const warning = sourceChecks > 0 ? { ...cleanupWarning, occurrences: [...(onlySourceChecks ? [] : corrections), ...preservedRows] } : boundaries ? { ...cleanupWarning, occurrences: boundaryRows } : consolidated ? consolidatedCleanupWarning : many ? { ...cleanupWarning, occurrences: Array.from({ length: 150 }, (_, i) => ({ ...cleanupWarning.occurrences[0], id: `ai-${i}`, source: `Source fragment ${i}`, replacement: `Corrected fragment ${i}` })) } : cleanupWarning;
      return stage === "review" ? Object.assign(candidate, { warnings: [{ ...warning }, ...(consolidated ? [{ id: "front-matter", kind: "front-back-matter", severity: "warning", availableActions: ["keep", "exclude"], occurrences: [{ id: "author-note", source: "About the author", text: "About the author", page: 4 }] }] : [])], boundaryCandidates: [] }) : candidate;
    };
    return fixture;
  }, [consolidated, many, boundaries, sourceChecks, onlySourceChecks]);
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
    await userEvent.click(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ }));
    await expect(canvas.getByRole("heading", { name: "Does this text match the source?" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
export const KeptChoiceIsPreservedByBulk: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Keep original text/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ }));
    await expect(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await expect(canvas.getByRole("button", { name: /^Keep original text/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: /^Leave out(?: \(Suggested\))? This highlighted/ }));
    await expect(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ })).toBeDisabled();
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
    await userEvent.click(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ }));
    await expect(canvas.getByText("A strange fragment.")).toBeVisible();
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Review groups" })).getByRole("button", { name: /AI suggestions/ }));
    await expect(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ })).toBeDisabled();
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
    await userEvent.click(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ }));
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: /^Keep original text/ }));
    await expect(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices|All suggestions decided)/ })).toBeDisabled();
  },
};

export const BoundarySuggestions: Story = {
  args: { boundaries: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Page 1 → Page 2")).toBeVisible();
    await expect(canvas.getByLabelText("Manuscript context")).toHaveTextContent("hereyes");
    await userEvent.click(canvas.getByRole("button", { name: /^Keep original text/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^(Apply remaining AI suggestions|Apply all suggested choices)/ }));
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
    await expect(canvas.getByText("Example 2 of 2")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Review complete transcript →" }));
    await expect(await canvas.findByRole("article", { name: "Audiobook transcript page 1" })).toBeVisible();
  },
};

export const MixedSourceChecks: Story = {
  args: { sourceChecks: 169 },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Example 1 of 4")).toBeVisible();
    await expect(canvas.queryByText(/169|173/)).not.toBeInTheDocument();
    await expect(canvas.getByText("4 remaining · 0 already decided · 4 suggested changes")).toBeVisible();
  },
};
export const OnlySourceChecks: Story = {
  args: { sourceChecks: 169, onlySourceChecks: true },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/169|173/)).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Nothing needs review" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
  },
};
