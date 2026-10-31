import type { WizardSnapshot } from "../api/contracts";

/** Retain all offered languages; unknown or malformed scores never move an option up. */
export function rankedVoiceLanguages(languages: string[], probabilities?: Record<string, number>, detected?: string) {
  const score = (language: string) => {
    const value = probabilities?.[language];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value : !probabilities && language === detected ? 1 : 0;
  };
  return [...languages].sort((left, right) => score(right) - score(left));
}

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
