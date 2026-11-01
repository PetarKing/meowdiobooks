import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import type { CastArtifact } from "../src/api/contracts";
import { CastIdentityReview } from "../src/components/CastIdentityReview";
import { PresentationRoot } from "../src/components/PresentationRoot";
import { decisionsForCast, resolvedLabelsForCast } from "../src/workflow/cast";

const contextAfter = "After Eli showed his notebook, Mara Vale followed suit. She had written down the same route through the garden, including the old bridge and the path beside the pond. This was a plan they had discussed the night before, rather than a sudden coincidence.";
const cast: CastArtifact = {
  revision: "synthetic-cast-evidence", phase: "identity-review",
  dossiers: [
    { label: "Mara", occurrenceCount: 1, examples: [{ page: 12, sourceText: "I'll show mine, too.", contextBefore: "Eli held up the notebook for everyone to see.", contextAfter }] },
    { label: "Eli", occurrenceCount: 4, examples: [{ page: 12, sourceText: "We can take the garden path." }] },
    { label: "Production credit", occurrenceCount: 1, examples: [{ page: 1, sourceText: "Production credit: Avery Reed" }] },
    { label: "Record field", occurrenceCount: 1, examples: [{ page: 2, sourceText: "Record field: First year, Class B" }] },
  ],
  proposals: [
    { label: "Mara", category: "character", canonicalName: "Mara", reviewRequired: false },
    { label: "Eli", category: "character", canonicalName: "Eli", reviewRequired: false },
    { label: "Production credit", category: "editorial", canonicalName: "", reviewRequired: true },
    { label: "Record field", category: "editorial", canonicalName: "", reviewRequired: true },
  ],
};
function CastEvidence() {
  const [decisions, setDecisions] = useState(() => decisionsForCast(cast));
  const [resolved, setResolved] = useState(() => resolvedLabelsForCast(cast));
  const appearance = new URLSearchParams(location.search).get("appearance") === "dark" ? "dark" : "light";
  return <PresentationRoot appearance={appearance} style={{ minHeight: "160vh", padding: 20 }}>
    <main style={{ maxWidth: 1100, margin: "auto", transform: "translateZ(0)" }}>
      <h1>Review the cast</h1><p>Synthetic source evidence and reversible Narrator assignments.</p>
      <CastIdentityReview cast={cast} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolved} setResolvedLabels={setResolved} voiceModels={[]} voiceModel="" language="english" onVoiceModelChange={() => undefined} onLanguageChange={() => undefined} hideVoiceSettings />
    </main>
  </PresentationRoot>;
}
const meta = { title: "Workflow/Cast evidence", component: CastEvidence } satisfies Meta<typeof CastEvidence>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NarratorReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const narrator = canvas.getByRole("button", { name: "Inspect Narrator" });
    await expect(narrator).toHaveTextContent("Must review");
    await expect(canvas.queryByRole("button", { name: "Inspect Production credit" })).toBeNull();
    await userEvent.click(narrator);
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Inspect Narrator" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Confirm Narrator assignments" })).toBeVisible());
    await expect(dialog.getAllByRole("button", { name: "Pop out to cast" })).toHaveLength(2);
  },
};
export const FullContext: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Inspect Mara" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Inspect Mara" });
    const context = within(dialog).getByText(contextAfter);
    await waitFor(() => expect(context).toBeVisible());
    await expect(getComputedStyle(context).whiteSpace).toBe("pre-wrap");
    await expect(context.scrollWidth).toBeLessThanOrEqual(context.clientWidth + 1);
  },
};
export const MergeUndo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const source = canvas.getByRole("button", { name: "Inspect Mara" });
    const target = canvas.getByRole("button", { name: "Inspect Eli" });
    const dataTransfer = new DataTransfer();
    await fireEvent.dragStart(source, { dataTransfer });
    await fireEvent.dragOver(target, { dataTransfer });
    await fireEvent.drop(target, { dataTransfer });
    const message = await within(document.body).findByText("Merged Mara into Eli.");
    const toast = message.closest<HTMLElement>("[role=status]")!;
    const checkPosition = () => {
      const rect = toast.getBoundingClientRect();
      // Fixed percentages use the layout viewport, excluding a classic scrollbar.
      const viewportWidth = document.documentElement.clientWidth;
      expect(Math.abs(rect.x + rect.width / 2 - viewportWidth / 2)).toBeLessThan(1);
      expect(innerHeight - rect.bottom).toBeLessThan(50);
      expect(rect.right).toBeLessThanOrEqual(viewportWidth);
    };
    await expect(toast.parentElement).toBe(document.body);
    checkPosition();
    window.scrollTo(0, 200);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    checkPosition();
    await expect(canvas.queryByRole("button", { name: "Inspect Mara" })).toBeNull();
  },
};
