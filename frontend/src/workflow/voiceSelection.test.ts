import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WizardSnapshot } from "../api/contracts";
import { useWorkflowModel } from "../app/useWorkflowModel";
import { createFixtureGateway, snapshotFor } from "../../design-kit/fixtures";
import { draftVoiceSelection } from "./voiceSelection";

const models = [
  { id: "balanced", label: "Balanced", supportedLanguages: ["english", "french"] },
  { id: "studio", label: "Studio", supportedLanguages: ["japanese"] },
];

describe("draftVoiceSelection", () => {
  it("recovers an unavailable model before any auditions are bound", () => {
    expect(draftVoiceSelection(models, ["removed-model", "balanced"], ["german", "french"]))
      .toEqual({ modelId: "balanced", language: "french" });
  });

  it("keeps an offered preference and falls back only within its languages", () => {
    expect(draftVoiceSelection(models, ["studio", "balanced"], ["english"]))
      .toEqual({ modelId: "studio", language: "japanese" });
  });

  it("skips models that cannot narrate any language", () => {
    expect(draftVoiceSelection([{ id: "empty", label: "Empty", supportedLanguages: [] }, ...models], ["empty"], []))
      .toEqual({ modelId: "balanced", language: "english" });
  });

  it("returns an unavailable state when there is no usable model", () => {
    expect(draftVoiceSelection([], ["removed-model"], ["english"]))
      .toEqual({ modelId: "", language: "" });
  });
});

describe("saved audition selection", () => {
  beforeEach(() => { localStorage.clear(); });

  async function restore(snapshot: WizardSnapshot) {
    const gateway = createFixtureGateway("cast-voices");
    gateway.getBookSnapshot = vi.fn().mockResolvedValue(snapshot);
    const { result } = renderHook(() => useWorkflowModel({ gateway }));
    await act(async () => { await result.current.hydrate(snapshot.book.id); });
    return result.current;
  }

  it("preserves unavailable model and language bindings of generated auditions", async () => {
    const base = snapshotFor("cast-voices");
    const model = await restore({ ...base, voiceModels: models,
      cast: { ...base.cast!, phase: "audition-review", voiceModel: "retired-model", language: "german" },
      voiceSelection: { modelId: "balanced", language: "english" },
    });
    expect(model.voiceModel).toBe("retired-model");
    expect(model.language).toBe("german");
    expect(model.narrationLanguageConfirmed).toBe(true);
  });

  it("preserves an unavailable selection when resuming the matching saved job", async () => {
    const base = snapshotFor("cast-voices");
    const model = await restore({ ...base, voiceModels: models,
      cast: { ...base.cast!, revision: "identity-1", phase: "identity-review", voiceModel: "balanced", language: "english" },
      recoverableStages: { cast: { proposalRevision: "identity-1", attempt: 1, message: "Saved", modelId: "retired-model", language: "german" } },
    });
    expect(model.voiceModel).toBe("retired-model");
    expect(model.language).toBe("german");
    expect(model.castGenerationPaused).toBe(true);
    expect(model.narrationLanguageConfirmed).toBe(true);
  });

  it("does not bind a fresh identity proposal to an unrelated old attempt", async () => {
    const base = snapshotFor("cast-voices");
    const model = await restore({ ...base, voiceModels: models,
      cast: { ...base.cast!, revision: "identity-2", phase: "identity-review", voiceModel: "retired-model", language: "german" },
      voiceSelection: { modelId: "balanced", language: "english" },
      recoverableStages: { cast: { proposalRevision: "identity-1", attempt: 1, message: "Saved", modelId: "retired-model", language: "german" } },
    });
    expect(model.voiceModel).toBe("balanced");
    expect(model.language).toBe("english");
    expect(model.castGenerationPaused).toBe(false);
    expect(model.narrationLanguageConfirmed).toBe(false);
  });
});
