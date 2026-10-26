import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import App from "../src/App";
import { createFixtureGateway, snapshotFor } from "../design-kit/fixtures";

function CastingConfirmation() {
  const [gateway] = useState(() => {
    const snapshot = snapshotFor("cast-identities");
    snapshot.cast = { revision: "cast-confirmation-draft", phase: "identity-review", dossiers: [], proposals: [],
      detectedLanguage: "french", languageProbabilities: { french: 0.9, english: 0.1 }, voiceModel: "qwen" };
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

export const DetectedLanguage: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Alice.*Continue/ }));
    const navigation = await canvas.findByRole("navigation", { name: "Wizard stages" });
    await userEvent.click(within(navigation).getByText("Cast & voices"));
    await userEvent.click(await canvas.findByRole("button", { name: "Next →" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Ready for their voices?" }));
    await dialog.findByText("≈ €2.94");
    const selector = dialog.getByRole("combobox", { name: "Narration language" });
    await expect(selector).toHaveValue("french");
    await waitFor(() => expect(dialog.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    await userEvent.click(selector);
    await expect(dialog.getAllByRole("option")[0]).toHaveAccessibleName("french");
    await userEvent.click(dialog.getByRole("option", { name: "english" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Generate voices →" })).toBeEnabled());
    await userEvent.click(dialog.getByRole("button", { name: "← Back to cast" }));
    await userEvent.click(canvas.getByRole("button", { name: "Next →" }));
    await expect(within(document.body).getByRole("combobox", { name: "Narration language" })).toHaveValue("english");
  },
};

export const ExpandedLanguage: StoryObj<typeof meta> = {
  play: async (context) => {
    await DetectedLanguage.play?.(context);
    const dialog = within(within(document.body).getByRole("dialog", { name: "Ready for their voices?" }));
    await userEvent.click(dialog.getByRole("combobox", { name: "Narration language" }));
    await expect(dialog.getByRole("listbox")).toBeVisible();
    await expect(dialog.getByRole("option", { name: "english" })).toHaveAttribute("aria-selected", "true");
  },
};
