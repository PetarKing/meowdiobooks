import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { WorkflowScenario } from "./workflowScenario";
import { enterScenario } from "./enterScenario";

const meta = {
  title: "Product/Workflow sidebar",
  component: WorkflowScenario,
  args: { scenario: "review" },
  parameters: { docs: { description: { component: "Interactive workflow sidebar. Use the app theme toggle and Storybook viewport controls to compare tablet, desktop, and the unchanged phone progress strip." } } },
} satisfies Meta<typeof WorkflowScenario>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {
  play: async ({ canvasElement }) => { await enterScenario(canvasElement, "review"); },
};
export const AcceptReviewAndContinue: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Leave out All 8/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^Keep with narrator This highlighted/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Review complete transcript →" }));
    await expect(await canvas.findByRole("article", { name: "Audiobook transcript page 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Accept review and continue →" }));
    await expect(await canvas.findByRole("heading", { name: "Voices" })).toBeVisible();
    const nav = within(canvas.getByRole("navigation", { name: "Wizard stages" }));
    await expect(nav.getByRole("button", { name: "Review Complete" })).toBeEnabled();
    await expect(nav.getByRole("button", { name: /^Cast & voices / })).toHaveAttribute("aria-current", "step");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};
export const CollapseAndNavigate: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Wizard stages" });
    const review = within(nav).getByRole("button", { name: /^Review / });
    await expect(review).toHaveAttribute("aria-current", "step");
    if (window.matchMedia("(min-width: 751px)").matches) {
      await userEvent.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
      await expect(canvas.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
      await expect(review).toHaveAttribute("aria-current", "step");
      await userEvent.click(within(nav).getByRole("button", { name: /^Extract / }));
      await expect(within(nav).getByRole("button", { name: /^Extract / })).toHaveAttribute("aria-current", "step");
      await userEvent.click(review);
      await userEvent.click(canvas.getByRole("button", { name: "Expand sidebar" }));
      await expect(review).toHaveAttribute("aria-current", "step");
    }
  },
};
