import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway } from "../design-kit/fixtures";
import { scriptDirectionsWarning } from "../design-kit/scriptDirectionsFixture";
import { enterScenario } from "./enterScenario";

function ScriptDirections() {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway("review");
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === "review" ? Object.assign(candidate, { warnings: [scriptDirectionsWarning], boundaryCandidates: [], scriptDirectionsSummary: { candidates: 33, proposals: 3, kept: 30 } }) : candidate;
    };
    return fixture;
  }, []);
  return <App gateway={gateway} />;
}

const meta = { title: "Product/Script directions", component: ScriptDirections } satisfies Meta<typeof ScriptDirections>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Suggestions: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Script directions" })).toBeVisible();
    await expect(canvas.getByText(/The floorboards creaked/)).toBeVisible();
    await expect(canvas.getByText(/If they hear us/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeDisabled();
  },
};
export const ManualChoiceSurvivesBulk: Story = {
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, "review");
    const canvas = within(canvasElement);
    const apply = canvas.getByRole("button", { name: /^Apply suggested choices/ });
    await expect([...apply.parentElement!.querySelectorAll("button")].map((button) => button.querySelector("b")?.textContent)).toEqual(["Keep", "Leave", "Apply suggested choices"]);
    await userEvent.click(canvas.getByRole("button", { name: /^Keep This highlighted/ }));
    await userEvent.click(apply);
    await expect(apply).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "← Previous example" }));
    await expect(canvas.getByRole("button", { name: /^Keep This highlighted/ })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button", { name: "Review complete transcript →" })).toBeEnabled();
  },
};
