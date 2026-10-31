import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkflowScenario } from "./workflowScenario";
import { enterScenario } from "./enterScenario";

const meta = {
  title: "Product/Dark appearance",
  // Preserve the selected preview URL after promoting its palette to production.
  id: "product-dark-palette-options",
  component: WorkflowScenario,
  args: { scenario: "review", appearance: "dark" },
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
