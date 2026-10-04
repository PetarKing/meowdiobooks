import type { WizardStage } from "../api/contracts";

export type WizardStep = Exclude<WizardStage, "import"> | "export";
export type JourneyStepId = string;
export type ProductView = "create" | "library";

export interface JourneyStep {
  id: JourneyStepId;
  label: string;
  builtin?: WizardStep;
  completionStage?: WizardStage;
}

export class JourneyDefinition {
  readonly steps: readonly JourneyStep[];

  constructor(steps: readonly JourneyStep[]) {
    const ids = steps.map((step) => step.id);
    if (!steps.length || new Set(ids).size !== ids.length) {
      throw new Error("Journey steps must be non-empty and unique");
    }
    this.steps = Object.freeze(steps.map((step) => Object.freeze({ ...step })));
  }

  step(stepId: JourneyStepId) {
    const step = this.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`Unknown journey step: ${stepId}`);
    return step;
  }

  indexOf(stepId: JourneyStepId) {
    const index = this.steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new Error(`Unknown journey step: ${stepId}`);
    return index;
  }

  insertAfter(anchorId: JourneyStepId, step: JourneyStep) {
    if (this.steps.some((candidate) => candidate.id === step.id)) {
      throw new Error(`Journey step already exists: ${step.id}`);
    }
    const index = this.indexOf(anchorId) + 1;
    return new JourneyDefinition([
      ...this.steps.slice(0, index),
      step,
      ...this.steps.slice(index),
    ]);
  }

  remove(stepId: JourneyStepId) {
    this.step(stepId);
    return new JourneyDefinition(this.steps.filter((step) => step.id !== stepId));
  }

  replace(stepId: JourneyStepId, replacement: JourneyStep) {
    this.step(stepId);
    if (replacement.id !== stepId && this.steps.some((step) => step.id === replacement.id)) {
      throw new Error(`Journey step already exists: ${replacement.id}`);
    }
    return new JourneyDefinition(
      this.steps.map((step) => step.id === stepId ? replacement : step),
    );
  }

  group(stepIds: readonly JourneyStepId[], replacement: JourneyStep) {
    if (!stepIds.length) throw new Error("Journey group requires at least one step");
    const indices = stepIds.map((stepId) => this.indexOf(stepId));
    const sorted = [...indices].sort((left, right) => left - right);
    if (sorted.some((value, index) => index > 0 && value !== sorted[index - 1] + 1)) {
      throw new Error("Journey groups must contain contiguous steps");
    }
    const grouped = new Set(stepIds);
    if (!grouped.has(replacement.id) && this.steps.some((step) => step.id === replacement.id)) {
      throw new Error(`Journey step already exists: ${replacement.id}`);
    }
    const first = sorted[0];
    return new JourneyDefinition([
      ...this.steps.slice(0, first).filter((step) => !grouped.has(step.id)),
      replacement,
      ...this.steps.slice(first).filter((step) => !grouped.has(step.id)),
    ]);
  }

  next(completed: readonly WizardStage[]) {
    const accepted = new Set(completed);
    const generateIndex = this.steps.findIndex((step) => step.builtin === "generate");
    for (let index = 0; index < this.steps.length; index += 1) {
      const step = this.steps[index];
      if (step.builtin === "export" || step.builtin === "generate") continue;
      if (step.completionStage && !accepted.has(step.completionStage)) return index;
    }
    return generateIndex >= 0 ? generateIndex : Math.max(0, this.steps.length - 1);
  }
}

export const productPaths: Record<ProductView, string> = {
  create: "/",
  library: "/library",
};

export const sidebarPreferenceKey = "meowdiobooks.sidebarCollapsed";

export const publicJourney = new JourneyDefinition([
  { id: "extract", label: "Extract", builtin: "extract", completionStage: "extract" },
  { id: "dialogue", label: "Dialogue", builtin: "dialogue", completionStage: "dialogue" },
  { id: "review", label: "Review", builtin: "review", completionStage: "review" },
  { id: "cast", label: "Cast & voices", builtin: "cast", completionStage: "cast" },
  { id: "generate", label: "Generate", builtin: "generate" },
  { id: "export", label: "Export", builtin: "export" },
]);

export const stages = publicJourney.steps;

export function productViewFromPath(pathname: string): ProductView {
  if (pathname === productPaths.library) return "library";
  return "create";
}

export function stageIndex(stageId: JourneyStepId, journey = publicJourney) {
  return journey.indexOf(stageId);
}

export function persistedSidebarCollapsed() {
  try {
    return localStorage.getItem(sidebarPreferenceKey) === "true";
  } catch {
    return false;
  }
}

export function nextStage(completed: readonly WizardStage[], journey = publicJourney) {
  return journey.next(completed);
}

export { persistWorkflowReturn } from './workflowLocation';
