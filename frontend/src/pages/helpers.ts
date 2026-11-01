import type { DialogueConflict, ExtractionMethod } from "../api/contracts";

export function formatApiCost(value: number) {
  if (value === 0) return "$0.00";
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}


export function methodLabel(method: ExtractionMethod) {
  return method === "ocr" ? "Full OCR" : method === "liteparse" ? "Standard" : method === "native" ? "Embedded text" : "Complex layout";
}

export type DialogueConflictGroup = {
  groupId: string;
  profileIds: [string, string];
  conflicts: DialogueConflict[];
  winnerProfileId?: string;
};

export function groupDialogueConflicts(conflicts: DialogueConflict[]): DialogueConflictGroup[] {
  const groups = new Map<string, DialogueConflictGroup>();
  for (const conflict of conflicts) {
    const current = groups.get(conflict.groupId);
    if (current) current.conflicts.push(conflict);
    else groups.set(conflict.groupId, {
      groupId: conflict.groupId,
      profileIds: conflict.profileIds,
      conflicts: [conflict],
      winnerProfileId: conflict.winnerProfileId,
    });
  }
  return [...groups.values()];
}
