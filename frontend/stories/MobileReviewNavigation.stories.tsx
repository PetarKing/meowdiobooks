import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway } from "../design-kit/fixtures";
import { cleanupWarning } from "../design-kit/cleanupFixture";
import { enterScenario } from "./enterScenario";

// Synthetic split title and review queue; no customer manuscript or runtime data.
function MobileReviewNavigation() {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === "review" ? Object.assign(candidate, {
        boundaryCandidates: [{ id: "split-title", page: 2, source: "MARA", reason: "Standalone heading", contextLayout: "continuous",
          contextBefore: "That is why these memories have been gathered here. Each reader may decide what to make of them.\n\n   ",
          contextAfter: "\n\n\n\nVA LE’S\n\n\n\nRE C ORD S\n\nFor every reader\n\nThe first day began with a letter. She opened it beside the window and watched the morning light cross the floor." }],
        warnings: [{ ...cleanupWarning, occurrences: cleanupWarning.occurrences.slice(0, 2) },
          { id: "source-check", kind: "suspicious-extraction", severity: "warning", availableActions: ["keep", "exclude"], occurrences: [{ id: "odd-word", page: 3, source: "STR ANGE", text: "STR ANGE" }] }],
      }) : candidate;
    };
    return fixture;
  }, []);
  return <App gateway={gateway} />;
}
const meta = { title: "Product/Mobile review navigation", component: MobileReviewNavigation } satisfies Meta<typeof MobileReviewNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SplitTitle: Story = { play: async ({ canvasElement }) => { await enterScenario(canvasElement, "review"); } };
export const Suggestions: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Review groups" })).getByRole("button", { name: /AI suggestions/ }));
  },
};
export const FinishedCategory: Story = {
  play: async ({ canvasElement }) => {
    await Suggestions.play!({ canvasElement } as Parameters<NonNullable<typeof Suggestions.play>>[0]);
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^Apply all suggested choices/ }));
  },
};
export const CompleteJourney: Story = {
  play: async ({ canvasElement }) => {
    await FinishedCategory.play!({ canvasElement } as Parameters<NonNullable<typeof FinishedCategory.play>>[0]);
    const canvas = within(canvasElement);
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    await expect(canvas.getByText("This category is complete")).toBeInTheDocument();
    if (mobile) await userEvent.click(canvas.getByRole("button", { name: "Continue review: Chapter starts →" }));
    else await userEvent.click(within(canvas.getByRole("navigation", { name: "Review groups" })).getByRole("button", { name: /Chapter starts/ }));
    const heading = canvas.getByRole("heading", { name: "Chapter starts" });
    if (mobile) await waitFor(() => expect(canvasElement.querySelector(".review-strip > button.active")).toHaveFocus());
    await expect(canvas.getByLabelText("Manuscript context")).toHaveTextContent("The first day began with a letter.");
    await userEvent.click(canvas.getByRole("button", { name: /^Start a new chapter/ }));
    if (mobile) {
      await expect(heading).toBeVisible();
      await expect(canvas.getByText("This category is complete")).toBeVisible();
      await userEvent.click(canvas.getByRole("button", { name: "Continue review: Suspicious extracted text →" }));
      await waitFor(() => expect(canvasElement.querySelector(".review-strip > button.active")).toHaveFocus());
    }
    await userEvent.click(canvas.getByRole("button", { name: /^Keep as is/ }));
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Review complete transcript →" }));
    await expect(await canvas.findByRole("article", { name: "Audiobook transcript page 1" })).toBeVisible();
    await expect(canvas.getByRole("main")).toHaveFocus();
    await expect(window.scrollY).toBe(0);
    await userEvent.click(canvas.getByRole("button", { name: "← Back to decisions" }));
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
  },
};
