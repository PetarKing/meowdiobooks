import { type ComponentType, type ReactNode } from "react";
import type {
  Book,
  LibraryExport,
  WizardSnapshot,
  WizardStage,
  WorkflowGateway
} from "../api/contracts";
import type { PresentationPalette } from "../components/PresentationRoot";
import {
  type GenerationEstimatePolicy
} from "../workflow/generation";
import {
  type JourneyDefinition,
  type JourneyStep,
  type JourneyStepId,
  type ProductView
} from "../workflow/navigation";

export interface AppProps {
  /** Optional host-controlled UI preference; does not alter supplied palette values. */
  appearance?: import('./useAppearance').Appearance;
  onAppearanceChange?: (appearance: import('./useAppearance').Appearance) => void;
  presentationPalette?: PresentationPalette;
  gateway?: WorkflowGateway;
  journey?: JourneyDefinition;
  stepOverrides?: Readonly<Record<JourneyStepId, ComponentType<WorkflowStepOverrideProps>>>;
  renderHeader?: (context: WorkflowHeaderContext) => ReactNode;
  renderLibraryActions?: (item: LibraryExport) => ReactNode;
  capabilities?: Partial<WorkflowCapabilities>;
  generationEstimatePolicy?: Partial<GenerationEstimatePolicy>;
}

export interface WorkflowCapabilities {
  localDialogueAttribution: boolean;
  showExecutionBadge: boolean;
  showProviderCostReceipts: boolean;
}

export interface WorkflowStepOverrideProps {
  step: JourneyStep;
  gateway: WorkflowGateway;
  book?: Book;
  snapshot?: WizardSnapshot;
  completedStages: readonly WizardStage[];
  busy: boolean;
  refresh: () => Promise<void>;
  navigateToStep: (stepId: JourneyStepId) => void;
}

export interface WorkflowHeaderContext {
  productView: ProductView;
  libraryCount: number;
  navigate: (view: ProductView) => void;
}
