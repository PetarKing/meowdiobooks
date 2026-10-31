import type { RawDialogueCandidate } from "../api/contracts";
import type { DialogueCorrectionDecision } from "../components/DialogueResultReview";

export function dialogueCorrections(candidate: RawDialogueCandidate): DialogueCorrectionDecision[] {
  return (candidate.userCorrections ?? []).flatMap((raw) => {
    const spanId = String(raw.spanId ?? "").trim();
    const action = String(raw.action ?? "");
    if (!spanId || (action !== "speaker" && action !== "narrator")) return [];
    const speakerLabel = String(raw.speakerLabel ?? "").trim();
    if (action === "speaker" && !speakerLabel) return [];
    return [{ spanId, action, ...(action === "speaker" ? { speakerLabel } : {}), provenance: "user" as const }];
  });
}
