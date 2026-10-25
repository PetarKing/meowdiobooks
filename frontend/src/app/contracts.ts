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
  /** Maximum source file bytes; hosts must enforce the same limit on their server. */
  maxImportBytes?: number;
  /** Scope browser return hints to the host identity; omit for the local application. */
  workflowPersistenceNamespace?: string;
  /** Explicit host return destination, including a job already dispatched by the host. */
  initialWorkflowLocation?: { bookId: string; stepId: string; activeJobId?: string };
  onActionRequired?: import('../api/actionRequired').ActionRequiredHandler;
  journey?: JourneyDefinition;
  stepOverrides?: Readonly<Record<JourneyStepId, ComponentType<WorkflowStepOverrideProps>>>;
  renderHeader?: (context: WorkflowHeaderContext) => ReactNode;
  renderLibraryActions?: (item: LibraryExport) => ReactNode;
  capabilities?: Partial<WorkflowCapabilities>;
  generationEstimatePolicy?: Partial<GenerationEstimatePolicy>;
  /** Host-confirmed purchase presentation for the current accepted scope; grants no workflow authority. */
  generationPurchase?: GenerationPurchasePresentation;
}

export interface GenerationPurchasePresentation {
  bookId: string;
  extractionRevision: string;
  dialogueRevision: string;
  reviewRevision: string;
  castRevision: string;
  scriptRevision: string | null;
  chapterIds: readonly string[];
}

export interface WorkflowCapabilities {
  localDialogueAttribution: boolean;
  showExecutionBadge: boolean;
  showProviderCostReceipts: boolean;
  /** Expose model configuration for installations whose users manage the voice runtime. */
  showVoiceModelControls: boolean;
  /** Expose advanced speaker-matching rules for installations whose users manage extraction. */
  advancedDialogueRules: boolean;
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
