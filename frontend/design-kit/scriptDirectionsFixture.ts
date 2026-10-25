import type { ReviewWarning } from "../src/api/contracts";

export const scriptDirectionsWarning: ReviewWarning = {
  id: "script-directions", kind: "stage-direction", decisionScope: "occurrence",
  severity: "warning", detail: "Verified delivery instructions.",
  readerState: "assigned-speaker", availableActions: ["keep", "exclude"],
  occurrences: [
    { id: "cue-soft", source: "[said softly]", contextBefore: "MARA: ", contextAfter: "Stay close." },
    { id: "cue-creepy", source: "(creepily)", contextBefore: "PEUS: ", contextAfter: "Hello there." },
    { id: "cue-loud", source: "[said very loudly]", contextBefore: "ALICE: ", contextAfter: "Over here!" },
  ].map((row) => ({ ...row, text: row.source, page: 1, recommendedAction: "exclude", cueVerification: "verified", availableActions: ["keep", "exclude"] })),
};
