import type { WizardSnapshot } from "../api/contracts";

/** A new cast must use an offered model; saved audition bindings stay explicit. */
export function draftVoiceSelection(
  models: WizardSnapshot["voiceModels"],
  preferredModels: Array<string | undefined>,
  preferredLanguages: Array<string | undefined>,
) {
  const available = models.filter((model) => model.supportedLanguages.length > 0);
  const model = preferredModels.map((id) => available.find((row) => row.id === id)).find(Boolean) ?? available[0];
  const supported = model?.supportedLanguages ?? [];
  const language = preferredLanguages.find((value) => value && supported.includes(value))
    ?? (supported.includes("english") ? "english" : supported[0] ?? "");
  return { modelId: model?.id ?? "", language };
}
