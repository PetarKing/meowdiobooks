import type { ReviewWarning } from "../src/api/contracts";

export const cleanupWarning: ReviewWarning = {
  id: "ai-group", kind: "ai-cleanup", detail: "Review corrections", severity: "warning", availableActions: ["keep", "repair", "rerun-extraction"],
  occurrences: [
    { id: "join", source: "bro-\nken", text: "bro-\nken", replacement: "broken", page: 1, reason: "A word wraps across a line.", availableActions: ["keep", "repair"] },
    { id: "delete", source: "Publisher 3", text: "Publisher 3", replacement: "", page: 2, reason: "Possible page furniture.", availableActions: ["keep", "repair"] },
    { id: "missing", source: "She opened the", text: "She opened the", page: 3, reason: "The source may be missing words.", availableActions: ["keep", "rerun-extraction"] },
  ],
};

