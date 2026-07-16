import type { WizardStage } from "../api/contracts";

export type WizardStep = Exclude<WizardStage, "import"> | "export";
export type ProductView = "create" | "library" | "player";

export const productPaths: Record<ProductView, string> = {
  create: "/",
  library: "/library",
  player: "/player",
};

export const sidebarPreferenceKey = "meowdiobooks.sidebarCollapsed";

export const stages: Array<{ id: WizardStep; label: string }> = [
  { id: "extract", label: "Extract" },
  { id: "dialogue", label: "Dialogue" },
  { id: "review", label: "Review" },
  { id: "cast", label: "Cast & voices" },
  { id: "enrich", label: "Enrich" },
  { id: "generate", label: "Generate" },
  { id: "export", label: "Export" },
];

export function productViewFromPath(pathname: string): ProductView {
  if (pathname === productPaths.library) return "library";
  if (pathname === productPaths.player) return "player";
  return "create";
}

export function stageIndex(stageId: WizardStep) {
  const index = stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) throw new Error(`Unknown visible wizard stage: ${stageId}`);
  return index;
}

export function persistedSidebarCollapsed() {
  try {
    return localStorage.getItem(sidebarPreferenceKey) === "true";
  } catch {
    return false;
  }
}

export function nextStage(completed: readonly WizardStage[]) {
  const accepted = new Set(completed);
  for (let index = 0; index < stageIndex("enrich"); index += 1) {
    if (!accepted.has(stages[index].id as WizardStage)) return index;
  }
  return accepted.has("enrich") ? stageIndex("generate") : stageIndex("enrich");
}
