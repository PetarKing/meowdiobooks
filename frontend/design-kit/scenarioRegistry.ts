import type { WizardStage } from "../src/api/contracts";

export type HomeScenarioAction = "open-book-error" | "open-delete-dialog";

export type WorkflowScenarioAction =
  | "accept-default-cast"
  | "build-dialogue"
  | "configure-sample"
  | "create-sample"
  | "design-voices"
  | "export"
  | "generate-selected"
  | "open-alice-voice"
  | "open-existing-voice"
  | "open-final-review"
  | "open-identity-inspector"
  | "open-layered-voice"
  | "open-new-audition"
  | "open-player"
  | "open-split"
  | "phase-help"
  | "scan-review";

export type ScenarioStoryAction = HomeScenarioAction | WorkflowScenarioAction;

export type SnapshotVariant =
  | "default"
  | "dialogue-results"
  | "dialogue-routing"
  | "dialogue-routing-unconfigured"
  | "dialogue-structural"
  | "export-long-book"
  | "generate-long-book"
  | "generate-split"
  | "generate-stale"
  | "review-boundaries"
  | "review-recovery"
  | "review-warnings";

export type CastFixtureVariant =
  | "auditions"
  | "dense-identities"
  | "dense-voices"
  | "identity-inspector"
  | "identity-review"
  | "layered"
  | "layered-confirmed"
  | "missing-audition"
  | "review-spectrum-identities"
  | "voice-design";

export type DialogueFixtureVariant = "conflicts" | "standard";

export type GatewayVariant =
  | "default"
  | "dialogue-reconnect"
  | "dialogue-running"
  | "empty-books"
  | "generate-failed"
  | "generate-running"
  | "home-error"
  | "home-shelf"
  | "library-error"
  | "library-loading"
  | "library-missing-cover"
  | "library-populated"
  | "library-refresh-error"
  | "sample-upload-pending";

export interface ScenarioMetadata {
  label: string;
  description: string;
  completedStages: readonly WizardStage[];
  snapshotVariant: SnapshotVariant;
  castFixture: CastFixtureVariant;
  dialogueFixture: DialogueFixtureVariant;
  castingPreviewAvailable: boolean;
  gatewayVariant: GatewayVariant;
  story:
    | {
        surface: "home";
        actions: readonly HomeScenarioAction[];
      }
    | {
        surface: "library";
        actions: readonly [];
        heading?: string;
      }
    | {
        surface: "workflow";
        actions: readonly WorkflowScenarioAction[];
        heading: string;
        acceptedStageLabel?: string;
      };
}

const throughImport = ["import"] as const satisfies readonly WizardStage[];
const throughExtract = [
  "import",
  "extract",
] as const satisfies readonly WizardStage[];
const throughDialogue = [
  "import",
  "extract",
  "dialogue",
] as const satisfies readonly WizardStage[];
const throughReview = [
  "import",
  "extract",
  "dialogue",
  "review",
] as const satisfies readonly WizardStage[];
const throughCast = [
  "import",
  "extract",
  "dialogue",
  "review",
  "cast",
] as const satisfies readonly WizardStage[];

/**
 * The scenario ID, catalogue copy, data, gateway and entry behavior share one
 * exhaustive definition. ScenarioId and the public catalogue are derived below.
 */
const baselineScenarioMetadata = {
  "cast-inspector": {
    label: "Cast · audition inspector",
    description: "Audition attempts, settings and generation controls.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["open-alice-voice"],
      heading: "Voices",
    },
  },
  "cast-missing": {
    label: "Cast · audition missing",
    description: "A voice has no playable audition and cannot be accepted.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "missing-audition",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["open-alice-voice"],
      heading: "Voices",
    },
  },
  "cast-accepted": {
    label: "Cast · accepted summary",
    description: "Accepted cast revision with replacement entry point.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Cast and voices ready",
      acceptedStageLabel: "Cast & voices",
    },
  },
  "extract-accepted": {
    label: "Extract · accepted summary",
    description: "Accepted extraction and replace settings action.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Extraction complete",
      acceptedStageLabel: "Extract",
    },
  },
  "dialogue-accepted": {
    label: "Dialogue · accepted summary",
    description: "Accepted transcript and revision action.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Transcript ready",
      acceptedStageLabel: "Dialogue",
    },
  },
  "review-accepted": {
    label: "Review · accepted summary",
    description: "Accepted review and chapter count.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Review complete",
      acceptedStageLabel: "Review",
    },
  },
  "generate-stale": {
    label: "Generate · older audio",
    description: "Older recording plus unavailable empty chapter.",
    completedStages: throughCast,
    snapshotVariant: "generate-stale",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Record your chapters",
    },
  },
  "generate-player": {
    label: "Generate · chapter player",
    description: "Listen dialog for generated audio controls.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["open-player"],
      heading: "Record your chapters",
    },
  },
  "generate-split": {
    label: "Generate · split confirmation",
    description: "Long chapter split explanation and confirmation.",
    completedStages: throughCast,
    snapshotVariant: "generate-split",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["open-split"],
      heading: "Record your chapters",
    },
  },
  "phase-help": {
    label: "Help · phase guide",
    description: "Existing keyboard-accessible phase help overlay.",
    completedStages: throughImport,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["phase-help"],
      heading: "Check the extracted text",
    },
  },
  "cast-voices": {
    label: "Cast · audition review",
    description:
      "Representative reusable screen: three generation attempts, selected and unconfirmed voices.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Voices",
    },
  },
  home: {
    label: "Create · existing books",
    description: "Import surface and books already in progress.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "home", actions: [] },
  },
  import: {
    label: "Create · empty",
    description:
      "Empty import surface; PDF selection is local to this preview.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "empty-books",
    story: { surface: "home", actions: [] },
  },
  "home-error": {
    label: "Create · book-open error",
    description:
      "Failed book snapshot request rendered by the real application.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "home-error",
    story: { surface: "home", actions: ["open-book-error"] },
  },
  "delete-dialog": {
    label: "Create · delete dialog",
    description: "Deletion confirmation; any deletion is in memory only.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "home", actions: ["open-delete-dialog"] },
  },
  library: {
    label: "Library · populated",
    description:
      "Complete and partial exports; synthetic metadata, no downloadable audio.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "library-populated",
    story: { surface: "library", actions: [], heading: "Your audiobooks" },
  },
  "library-empty": {
    label: "Library · empty",
    description: "No exported audiobooks.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "library", actions: [], heading: "Your audiobooks" },
  },
  "library-loading": {
    label: "Library · loading",
    description: "Deterministically pending cold Library load.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "library-loading",
    story: { surface: "library", actions: [] },
  },
  "library-error": {
    label: "Library · error",
    description: "Failed Library request.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "library-error",
    story: { surface: "library", actions: [] },
  },
  extract: {
    label: "Extract · preview",
    description: "PDF comparison, extraction choices and warning.",
    completedStages: throughImport,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Check the extracted text",
    },
  },
  dialogue: {
    label: "Dialogue · setup",
    description: "Detection settings and AI attribution choices.",
    completedStages: throughExtract,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Build the transcript",
    },
  },
  "dialogue-conflicts": {
    label: "Dialogue · conflicts",
    description: "Overlapping detection rules requiring a decision.",
    completedStages: throughExtract,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "conflicts",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Build the transcript",
    },
  },
  "dialogue-results": {
    label: "Dialogue · results",
    description:
      "Draft dialogue results, corrections and attribution evidence.",
    completedStages: throughExtract,
    snapshotVariant: "dialogue-results",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Your transcript is ready",
    },
  },
  review: {
    label: "Review · warnings",
    description: "Grouped warnings, evidence and consequence choices.",
    completedStages: throughDialogue,
    snapshotVariant: "review-warnings",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["scan-review"],
      heading: "Review your manuscript",
    },
  },
  "review-intro": {
    label: "Review · scan invitation",
    description: "Unscanned manuscript and source-check invitation.",
    completedStages: throughDialogue,
    snapshotVariant: "review-warnings",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Check for issues",
    },
  },
  "review-boundaries": {
    label: "Review · chapters",
    description: "Chapter heading decision and anchored examples.",
    completedStages: throughDialogue,
    snapshotVariant: "review-boundaries",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["scan-review"],
      heading: "Review your manuscript",
    },
  },
  "review-final": {
    label: "Review · final transcript",
    description: "Side-by-side source and reader transcript.",
    completedStages: throughDialogue,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["scan-review", "open-final-review"],
      heading: "Read it once like a listener.",
    },
  },
  "cast-identities": {
    label: "Cast · identity review",
    description: "Ambiguous identity review suggestions and merge workspace.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "identity-review",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "workflow", actions: [], heading: "Build the cast." },
  },
  "cast-review-states": {
    label: "Cast · required and suggested review",
    description: "Synthetic examples of a blocking identity decision, optional review, and ready cast members.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "review-spectrum-identities",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "workflow", actions: [], heading: "Build the cast." },
  },
  "cast-voice-review-states": {
    label: "Voices · required and optional review",
    description: "Synthetic missing audition, playable unapproved audition, and approved voice on one grid.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "missing-audition",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "workflow", actions: [], heading: "Voices" },
  },
  "cast-dense": {
    label: "Cast · 60 identities",
    description:
      "Dense synthetic ensemble with review suggestions and long labels.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "dense-identities",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: { surface: "workflow", actions: [], heading: "Build the cast." },
  },
  "cast-voices-dense": {
    label: "Cast · 60 voices",
    description: "Dense audition review with confirmed and unconfirmed voices.",
    completedStages: throughReview,
    snapshotVariant: "default",
    castFixture: "dense-voices",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Voices",
    },
  },
  generate: {
    label: "Generate · chapters",
    description:
      "Prepared script, chapter selections and current generated audio.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: [],
      heading: "Record your chapters",
    },
  },
  export: {
    label: "Export · edition",
    description: "Current chapter selection, cover and export formats.",
    completedStages: throughCast,
    snapshotVariant: "default",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["export"],
      heading: "Prepare your audiobook",
    },
  },
  "export-long-book": {
    label: "Export · 20 chapters",
    description:
      "Twenty synthetic generated chapters for reviewing selection density and export settings.",
    completedStages: throughCast,
    snapshotVariant: "export-long-book",
    castFixture: "auditions",
    dialogueFixture: "standard",
    castingPreviewAvailable: false,
    gatewayVariant: "default",
    story: {
      surface: "workflow",
      actions: ["export"],
      heading: "Prepare your audiobook",
    },
  },
} as const satisfies Record<string, ScenarioMetadata>;

/** Failure and recovery variants use the same real pages and in-memory gateway. */
export const scenarioMetadata = {
  ...baselineScenarioMetadata,
  "home-shelf": { ...baselineScenarioMetadata.home, label: "Create · six local books", description: "Responsive shelf of six synthetic local drafts.", gatewayVariant: "home-shelf" },
  "generate-long-book": { ...baselineScenarioMetadata.generate, label: "Generate · 120 chapters", description: "A long synthetic book for tracklist selection, estimates and listening.", snapshotVariant: "generate-long-book" },
  "library-missing-cover": { ...baselineScenarioMetadata.library, label: "Library · missing cover", description: "A broken cover resolves to the readable production fallback.", gatewayVariant: "library-missing-cover" },
  "library-refresh-error": { ...baselineScenarioMetadata.library, label: "Library · refresh failed", description: "Saved editions remain visible after a failed refresh.", gatewayVariant: "library-refresh-error" },
  "dialogue-running": { ...baselineScenarioMetadata.dialogue, label: "Dialogue · running", description: "Cancelable progress while the transcript is being built.", gatewayVariant: "dialogue-running", story: { ...baselineScenarioMetadata.dialogue.story, actions: ["build-dialogue"] } },
  "generate-running": { ...baselineScenarioMetadata.generate, label: "Generate · running", description: "Chapter progress with saved audio retained.", gatewayVariant: "generate-running", story: { ...baselineScenarioMetadata.generate.story, actions: ["generate-selected"] } },
  "generate-failed": { ...baselineScenarioMetadata.generate, label: "Generate · failed", description: "Generation failure preserves chapters and offers recovery.", gatewayVariant: "generate-failed", story: { ...baselineScenarioMetadata.generate.story, actions: ["generate-selected"] } },
  "cast-sample-pending": { ...baselineScenarioMetadata["cast-inspector"], label: "Cast · sample upload", description: "Sample upload stays pending; unavailable confirmation cannot proceed.", gatewayVariant: "sample-upload-pending", story: { ...baselineScenarioMetadata["cast-inspector"].story, actions: ["open-alice-voice", "configure-sample", "create-sample"] } },
  "review-recovery": { ...baselineScenarioMetadata.review, label: "Review · recovery", description: "Unsafe source coverage requires rebuilding Dialogue before acceptance.", snapshotVariant: "review-recovery", story: { ...baselineScenarioMetadata.review.story, actions: [], heading: "Dialogue needs rebuilding" } },
} as const satisfies Record<string, ScenarioMetadata>;

export type ScenarioId = keyof typeof scenarioMetadata;

/** Public catalogue derived from the same exhaustive source as its fixtures. */
export const scenarios = Object.entries(scenarioMetadata).map(
  ([id, { label, description }]) => ({
    id: id as ScenarioId,
    label,
    description,
  }),
);

export function metadataFor(id: ScenarioId): ScenarioMetadata {
  return scenarioMetadata[id];
}
