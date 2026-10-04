import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

function CastingConfirmation() {
  const [gateway] = useState(() => {
    const snapshot = snapshotFor("cast-identities");
    snapshot.cast = { revision: "cast-confirmation-draft", phase: "identity-review", dossiers: [], proposals: [], language: "english", voiceModel: "qwen" };
    snapshot.castingPreviewAvailable = true;
    snapshot.voiceModels = [{ id: "qwen", label: "Studio", supportedLanguages: ["english", "french"] }];
    snapshot.voiceSelection = { modelId: "qwen", language: "english" };
    return {
      ...createFixtureGateway("cast-identities"),
      getBookSnapshot: async () => structuredClone(snapshot),
      previewCasting: async () => ({
        fingerprint: "synthetic-language-quote", sources: [], exactMatchCount: 0,
        totalVoiceCount: 1, remainingVoiceCount: 1, currency: "EUR",
        options: [{ modelId: "qwen", label: "Studio", description: "Designed voices", estimatedCostMinor: 294 }],
      }),
    };
  });
  return <App gateway={gateway} />;
}

const meta = { title: "Workflow/Casting confirmation", component: CastingConfirmation } satisfies Meta<typeof CastingConfirmation>;
export default meta;

export const ConfirmSettledDefault: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Alice.*Continue/ }));
    const navigation = await canvas.findByRole("navigation", { name: "Wizard stages" });
    await userEvent.click(within(navigation).getByText("Cast & voices"));
    await userEvent.click(await canvas.findByRole("button", { name: "Design the voices →" }));
    await canvas.findByText("≈ €2.94");
    const selector = canvas.getByRole("combobox", { name: "Narration language" });
    await expect(selector).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Continue →" })).toBeDisabled();
    await userEvent.selectOptions(selector, "english");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Continue →" })).toBeEnabled());
  },
};
