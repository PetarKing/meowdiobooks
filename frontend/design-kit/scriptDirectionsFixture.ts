import type { ReviewWarning } from "../src/api/contracts";

export const scriptDirectionsWarning: ReviewWarning = {
  id: "script-directions", kind: "stage-direction", decisionScope: "occurrence",
  severity: "warning", detail: "Verified delivery instructions.",
  readerState: "assigned-speaker", availableActions: ["keep", "exclude"],
  occurrences: [
    { id: "cue-soft", source: "[said softly]", contextBefore: "The floorboards creaked beyond the locked door. Mara drew the candle closer and turned to her brother.\n\nMARA: ", contextAfter: " Stay close. If they hear us, we will have to find another way out.\n\nHe nodded and took her hand." },
    { id: "cue-creepy", source: "(creepily)", contextBefore: "A stranger waited beneath the broken streetlight.\n\nPEUS: ", contextAfter: " Hello there. I have been expecting you.\n\nNobody answered." },
    { id: "cue-loud", source: "[said very loudly]", contextBefore: "The boats drifted past without slowing. Alice climbed onto the rock.\n\nALICE: ", contextAfter: " Over here! We need your help.\n\nAt last, one of the rowers looked back." },
  ].map((row) => ({ ...row, text: row.source, page: 1, contextLayout: "continuous", recommendedAction: "exclude", cueVerification: "verified", availableActions: ["keep", "exclude"] })),
};
