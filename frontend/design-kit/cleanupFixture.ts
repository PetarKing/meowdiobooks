import type { ReviewWarning } from "../src/api/contracts";

export const cleanupWarning: ReviewWarning = {
  id: "ai-group", kind: "ai-cleanup", detail: "Review corrections", severity: "warning", availableActions: ["keep", "exclude", "repair", "rerun-extraction"],
  occurrences: [
    { id: "join", source: "bro-\nken", text: "bro-\nken", replacement: "broken", page: 1, reason: "A word wraps across a line.", availableActions: ["keep", "exclude", "repair"] },
    { id: "delete", source: "Publisher 3", text: "Publisher 3", replacement: "", page: 2, reason: "Possible page furniture.", availableActions: ["keep", "exclude", "repair"] },
    { id: "missing", source: "She opened the", text: "She opened the", page: 3, reason: "The source may be missing words.", availableActions: ["keep", "exclude", "rerun-extraction"] },
  ],
};


export const consolidatedCleanupWarning: ReviewWarning = {
  id: "suspicious-group", kind: "suspicious-extraction", decisionScope: "occurrence", detail: "Check source text", severity: "warning", readerState: "mixed",
  availableActions: ["keep", "exclude", "rerun-extraction", "repair"],
  occurrences: [
    { ...cleanupWarning.occurrences[0], proposalStatus: "proposed", cleanupReason: "Join a word split across a printed line.", reason: "Line-wrap hyphen detected.", readerState: "assigned-speaker" },
    { id: "ordinary", source: "A strange fragment.", text: "A strange fragment.", page: 2, readerState: "assigned-speaker", availableActions: ["keep", "exclude", "rerun-extraction"] },
    { ...cleanupWarning.occurrences[1], proposalStatus: "proposed", readerState: "narrator" },
    { ...cleanupWarning.occurrences[2], proposalStatus: "source_review", readerState: "narrator" },
  ],
};
