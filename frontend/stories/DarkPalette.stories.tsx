import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";
import { WorkflowScenario } from "./workflowScenario";
import { enterScenario } from "./enterScenario";

function InteractivePalette(args: ComponentProps<typeof WorkflowScenario>) {
  const [appearance, setAppearance] = useState(args.appearance);
  return <WorkflowScenario {...args} appearance={appearance} onAppearanceChange={setAppearance} />;
}

const meta = {
  title: "Product/Dark appearance",
  // Preserve the selected preview URL after promoting its palette to production.
  id: "product-dark-palette-options",
  component: WorkflowScenario,
  args: { scenario: "review", appearance: "dark" },
  render: args => <InteractivePalette key={args.appearance} {...args} />,
  parameters: { docs: { description: { component: "The approved Darker forest palette, using the shared production tokens. Home and workflow share the same base; Home retains its atmospheric gradient. No story-specific color overrides." } } },
} satisfies Meta<typeof WorkflowScenario>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DarkerForest: Story = {
  play: async ({ canvasElement }) => { await enterScenario(canvasElement, "review"); },
};
export const Home: Story = {
  args: { scenario: "home" },
  play: async ({ canvasElement }) => { await enterScenario(canvasElement, "home"); },
};
export const HomeThemeToggle: Story = {
  args: { scenario: "home" },
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "home");
    const toggle = within(canvasElement).getByRole("button", { name: "Toggle dark mode" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  },
};
