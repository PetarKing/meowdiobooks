export type WizardStage =
  | "import"
  | "extract"
  | "dialogue"
  | "review"
  | "cast"
  | "generate";

export type ExtractionMethod = "liteparse" | "native" | "layout" | "text";
export type DialogueStrategy = "fill-gaps" | "narrate";
export type DialogueAttributionTarget = "open-speakers" | "unlabelled-candidates";
export type DialogueAttributionRoute = "local" | "remote";
export type ArtifactKind = "extraction" | "dialogue" | "review" | "cast" | "script";

export interface LocalBook {
  id: string;
  title: string;
  source_name: string | null;
  source_kind: string | null;
  page_count: number | null;
  asset_size_bytes?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  filename: string;
  sourceKind?: string;
  pageCount?: number;
  completedStages: readonly WizardStage[];
}

export interface RepresentativePage { page: number; reason: string }

export interface ImportResult {
  book: LocalBook;
  representativePages: RepresentativePage[];
  duplicate: boolean;
}

export interface ExtractionPreview {
  page: number;
  pageCount: number;
  method: ExtractionMethod;
  text: string;
  warnings: Array<{ code: string; label: string }>;
  elapsedSeconds: number;
  cached: boolean;
  imageUrl?: string | null;
  sourceText?: string | null;
}

export interface DialogueExample {
  spanId: string;
  page: number;
  source: string;
  spokenText: string;
  speakerLabel?: string | null;
  speakerStatus: "explicit" | "open" | "unlabelled" | "ai" | "user" | "unresolved";
  origin: string;
  contextBefore?: string;
  contextAfter?: string;
  expandedContextBefore?: string;
  expandedContextAfter?: string;
  suggestedSpeakers?: string[];
}

export interface DialogueReaderAssignment {
  label: string;
  total: number;
  known: number;
  ai: number;
  user: number;
}

export interface DialogueRegex {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
  priority: number;
  enabled: boolean;
  builtIn: boolean;
  matchCount: number;
  examples: DialogueExample[];
}

export interface DialogueConflictClaim {
  matchId: string;
  profileId: string;
  page: number;
  source: string;
  spokenText: string;
  speakerLabel?: string | null;
  contextBefore?: string;
  contextAfter?: string;
}

export interface DialogueConflict {
  id: string;
  groupId: string;
  profileIds: [string, string];
  page: number;
  claims: [DialogueConflictClaim, DialogueConflictClaim];
  winnerProfileId?: string;
}

export interface DialogueConflictResolution {
  profileIds: [string, string];
  winnerProfileId: string;
}

export type DialogueStructuralAction = "split" | "keep-together" | "narration";

export interface DialogueStructuralClaim {
  matchId: string;
  profileId: string;
  page: number;
  source: string;
  spokenText: string;
  speakerLabel?: string | null;
}

export interface DialogueStructuralIssue {
  id: string;
  kind: "interrupted-turn";
  profileId: string;
  page: number;
  source: string;
  contextBefore?: string;
  contextAfter?: string;
  outerSpeakerLabel?: string | null;
  innerSpeakerLabels: string[];
  availableActions: DialogueStructuralAction[];
  interpretations: Record<DialogueStructuralAction, DialogueStructuralClaim[]>;
  selectedAction?: DialogueStructuralAction;
}

export interface DialogueStructuralResolution {
  issueId: string;
  action: DialogueStructuralAction;
}

export interface DialogueSettings {
  regexes: Array<Pick<DialogueRegex, "id" | "label" | "pattern" | "flags" | "priority" | "enabled" | "builtIn">>;
  openSpeakerPatterns: string[];
  strategy: DialogueStrategy;
  attributionTargets: DialogueAttributionTarget[];
  conflictResolutions?: DialogueConflictResolution[];
  structuralResolutions?: DialogueStructuralResolution[];
  attributionRoute?: DialogueAttributionRoute;
}

export interface DialogueRoutingPreview {
  targetCount: number;
  largeReviewThreshold: number;
  shouldPrompt: boolean;
  defaultRoute: DialogueAttributionRoute;
  local: { displayName: string; apiCostUsd: number };
  remote?: {
    displayName: string;
    domain: string;
    credentialConfigured: boolean;
    apiKeyEnvironmentVariable: string;
    estimatedCostUsd: number;
    falseNamesReductionPercent?: number;
    speakerRecallImprovementPercent?: number;
  } | null;
}

export interface DialogueSummary {
  totalTurns: number;
  regexClaims?: number;
  explicitTurns: number;
  openSpeakerTurns: number;
  unlabeledCandidates: number;
  conflicts: number;
  structuralIssues?: number;
  continuedTurns?: number;
  aiAttributed?: number;
  aiContributions?: number;
  aiSuggestedForReview?: number;
  unresolved?: number;
  userCorrected?: number;
}

export interface RemoteUsageReceipt {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  modelProfile: string;
  modelDisplayName: string;
  providerModels: string[];
}

export interface DialogueArtifact {
  scanVersion?: number;
  revision?: string;
  extractionRevision?: string;
  strategy?: DialogueStrategy;
  attributionTargets?: DialogueAttributionTarget[];
  regexes: DialogueRegex[];
  openSpeakerPatterns: string[];
  summary: DialogueSummary;
  examples: DialogueExample[];
  readerAssignments?: DialogueReaderAssignment[];
  conflicts?: DialogueConflict[];
  resolvedConflicts?: DialogueConflict[];
  conflictResolutions?: DialogueConflictResolution[];
  structuralIssues?: DialogueStructuralIssue[];
  resolvedStructuralIssues?: DialogueStructuralIssue[];
  structuralResolutions?: DialogueStructuralResolution[];
  speakerOptions?: string[];
  accepted?: boolean;
  routing?: DialogueRoutingPreview;
  remoteUsage?: RemoteUsageReceipt;
}

export type ReviewCapability =
  | "keep-hyphen"
  | "join-word"
  | "repair"
  | "keep"
  | "exclude"
  | "narrate"
  | "rerun-extraction"
  | "rerun-dialogue";

export interface WarningOccurrence {
  /** Context preserves whitespace adjacent to the anchored source. */
  contextLayout?: "continuous";
  recommendedAction?: "exclude";
  cueVerification?: "verified";
  readerState?: "narrator" | "assigned-speaker" | "mixed";
  proposalStatus?: "proposed" | "source_review";
  cleanupReason?: string;
  hyphenChoices?: Partial<Record<ReviewCapability, string>>;
  replacement?: string;
  availableActions?: ReviewCapability[];
  id: string;
  source: string;
  text: string;
  page: number;
  contextBefore?: string;
  contextAfter?: string;
  reason?: string;
}

export interface ReviewWarning {
  decisionScope?: "occurrence" | "identical-evidence" | "warning-kind";
  id: string;
  kind: string;
  detail: string;
  severity: "notice" | "warning" | "blocking";
  readerState?: "narrator" | "assigned-speaker" | "mixed";
  occurrences: WarningOccurrence[];
  availableActions: ReviewCapability[];
}

export interface BoundaryCandidate {
  contextLayout?: "continuous";
  contextBefore?: string;
  contextAfter?: string;
  id: string;
  page: number;
  source: string;
  reason?: string;
}

export interface ReviewDecision {
  occurrenceIds: string[];
  action: ReviewCapability;
  provenance: "user";
}

export interface CastDossier {
  label: string;
  occurrenceCount?: number;
  firstAppearance?: string | number;
  examples?: Array<{ source?: string; sourceText?: string; text?: string; contextBefore?: string; contextAfter?: string; page?: number }>;
  fuzzyCandidates?: string[];
}

export interface CastProposal {
  label: string;
  category: string;
  canonicalName: string;
  aliases?: string[];
  reviewRequired?: boolean;
  reason?: string;
  competingCandidates?: string[];
  competingLabels?: string[];
}

export interface VoiceCandidate {
  revision: string;
  previewUrl: string;
  previewText?: string;
  referenceText?: string;
  referenceAudio?: string;
  direction: string;
  voiceSettings?: VoiceSettings;
  source?: "generated" | "upload" | "shared" | "previous-book";
  previousBookTitle?: string;
  sharedVoiceGroupId?: string;
  referenceMode?: "transcript-conditioned" | "speaker-embedding";
  durationSeconds?: number;
}

export interface VoiceSettings {
  presentation: "feminine" | "masculine" | "androgynous" | "unspecified";
  age: "child" | "young-adult" | "adult" | "older-adult" | "unspecified";
  tone: "warm" | "bright" | "dark" | "gentle" | "crisp" | "gravelly" | "neutral";
  pitch: "low" | "medium" | "high" | "unspecified";
  pace: "measured" | "natural" | "brisk";
  energy: "restrained" | "balanced" | "animated";
  accent: string;
  description: string;
}

export type VoiceRoute =
  | { kind: "dedicated" }
  | { kind: "layered"; characterIds: string[] };

export interface CastVoice {
  characterId: string;
  name: string;
  category?: string;
  literalLabels?: string[];
  lineCount?: number;
  voicePreviewRevision?: string;
  previewUrl?: string;
  referenceText?: string;
  auditionLine?: string;
  voiceDirection?: string;
  voiceSettings?: VoiceSettings;
  voiceCandidates?: VoiceCandidate[];
  voiceAccepted?: boolean;
  acceptedVoiceRevision?: string;
  voiceRoute?: VoiceRoute;
}

export interface CastArtifact {
  /** Read-only exact-label matches, supplied by the composition. */
  previousVoiceMatches?: Record<string, { bookTitle: string }>;
  revision: string;
  phase: "identity-review" | "audition-review" | "accepted";
  reusedFromRevision?: string;
  auditionPackRecipeVersion?: string;
  auditionPackRefreshRequired?: boolean;
  dossiers: CastDossier[];
  proposals: CastProposal[];
  processing?: { labels?: number; batches?: number; model?: string };
  narrator?: CastVoice | null;
  identities?: CastVoice[];
  language?: string;
  voiceModel?: string;
  detectedLanguage?: string;
  identityDecisions?: Array<{
    label: string;
    category: string;
    canonicalName: string;
    aliases: string[];
    primaryLabel?: string;
  }>;
}

export interface RecordingScriptArtifact {
  revision: string;
  status: "ready";
  sourceCoverage?: { status?: string };
  entries?: Array<Record<string, unknown>>;
  chapters?: Chapter[];
  summary: RecordingScriptSummary;
  inputRevisions?: Record<string, string | null>;
}

export interface RecordingScriptChapterSummary {
  chapterId: string;
  totalCharacters: number;
  retainedCharacters: number;
  dialogueSpans: number;
  narratorFallbackSpans: number;
  estimatedSeconds: number;
  empty: boolean;
}

export interface RecordingScriptSummary {
  totalSpans: number;
  retainedSpans: number;
  omittedSpans: number;
  dialogueSpans: number;
  narratorFallbackSpans: number;
  totalCharacters: number;
  retainedCharacters: number;
  omittedCharacters: number;
  estimatedSeconds: number;
  emptyChapterIds: string[];
  chapters: RecordingScriptChapterSummary[];
  estimationMethod: string;
}

export interface GeneratedChapterArtifact {
  chapterId: string;
  revision: string;
  audioUrl: string;
  audioSeconds?: number;
  segments?: number | Array<Record<string, unknown>>;
  inputRevisions?: Record<string, string | null>;
  current: boolean;
  staleReasons: string[];
  revisions?: Array<Record<string, unknown>>;
}

export interface Chapter {
  id: string;
  title: string;
  startPage?: number;
  endPage?: number;
  estimatedCharacters?: number;
  splitFrom?: string;
  partNumber?: number;
  partCount?: number;
}

export interface ArtifactHistoryEntry { revision: string; createdAt?: string; status?: "candidate" | "accepted" | "superseded" }

export interface WizardSnapshot {
  book: Book;
  activeArtifacts: Partial<Record<ArtifactKind, string>>;
  pendingCandidates?: Partial<Record<ArtifactKind, ArtifactHistoryEntry>>;
  dialogue?: DialogueArtifact;
  dialogueRecovery?: {
    kind: "malformed-playable-span";
    spanIds: string[];
    page?: number;
    availableActions: ["rerun-dialogue"];
  };
  warnings: ReviewWarning[];
  boundaryCandidates: BoundaryCandidate[];
  reviewInspection: {
    decisions: ReviewDecision[];
    boundaryDecisions: Array<{ boundaryId: string; action: "chapter-start" | "not-a-boundary" }>;
    consequences: Record<string, unknown>;
    history: ArtifactHistoryEntry[];
  };
  cast?: CastArtifact;
  voiceModels: Array<{ id: string; label: string; recipeVersion?: string; supportedLanguages: string[] }>;
  castingPreviewAvailable?: boolean;
  voiceReuseAvailable?: boolean;
  voiceSelection: { modelId?: string; language?: string };
  recoverableStages?: Partial<Record<ProcessableStage, {
    attempt: number;
    message: string;
    modelId?: string;
    language?: string;
    proposalRevision?: string;
  }>>;
  recordingScript?: RecordingScriptArtifact;
  chapters: Chapter[];
  generatedChapters: GeneratedChapterArtifact[];
  history: Partial<Record<ArtifactKind, ArtifactHistoryEntry[]>>;
}

export interface ActionRequired {
  code: string;
  message: string;
  /** Opaque host metadata; carries no authority and must not contain credentials. */
  context: Record<string, unknown>;
}

export interface ActionRequiredContext {
  bookId?: string;
  stage?: string;
  jobId?: string;
  settings?: Record<string, unknown>;
}

export interface Job {
  id: string;
  kind?: string;
  status: "queued" | "running" | "canceled" | "succeeded" | "failed";
  payload?: Record<string, unknown>;
  error?: string | null;
  action_required?: ActionRequired | null;
  progress?: number;
  message?: string | null;
  cancel_requested_at?: string | null;
  result?: Record<string, unknown> | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface M4BExportChapter { chapterId: string; revision: string }
export interface M4BExportOptions { title?: string; author?: string; description?: string; cover?: File; coverPage?: number }
export type AudioExportPreset = "m4b-high" | "m4b-compact" | "mp3" | "mp3-chapters";
export interface AudioExportOptions extends M4BExportOptions { preset: AudioExportPreset }
export interface M4BDownload { blob: Blob; filename: string }
export interface LibraryExport {
  id: string;
  bookId: string;
  title: string;
  author: string;
  description?: string | null;
  filename: string;
  location: string;
  chapterCount: number;
  chapterTitles?: string[];
  chapterPositions?: number[];
  partial: boolean;
  sizeBytes: number;
  preset?: AudioExportPreset;
  mediaType?: string;
  createdAt: string;
}

export interface ReviewTranscriptPolicy {
  warningId: string;
  action: ReviewCapability;
}

export interface ReviewTranscriptOccurrencePolicy {
  occurrenceId: string;
  action: ReviewCapability;
}

export interface ReviewTranscriptSpan {
  id: string;
  kind: "narration" | "dialogue" | "excluded";
  reader: string;
  text: string;
  blockId: string;
  sourceStart: number;
  sourceEnd: number;
  warningKind?: string;
}

export interface ReviewTranscriptPreview {
  page: number;
  pageCount: number;
  imageUrl?: string | null;
  sourceText?: string | null;
  spans: ReviewTranscriptSpan[];
  summary: { spoken: number; dialogue: number; excluded: number };
  published: false;
}

export type ProcessableStage = Exclude<WizardStage, "import">;

export interface ExtractionProcessSettings {
  method: ExtractionMethod;
}

export interface SourceVoice { bookId: string; characterId: string; revision: string }

export interface CastingPreview {
  previousVoiceMatches?: CastArtifact["previousVoiceMatches"];
  fingerprint?: string;
  sources: Array<{ bookId: string; title: string; voiceCount: number; voices?: Array<{ characterId: string; name: string; revision: string }> }>;
  exactMatchCount: number;
  totalVoiceCount: number;
  remainingVoiceCount: number;
  currency?: string;
  options?: Array<{ modelId: string; label: string; description: string; estimatedCostMinor: number | null }>;
}

export interface CastProcessSettings {
  castingPreviewFingerprint?: string;
  sourceVoice?: SourceVoice;
  sourceBookIds?: string[];
  proposalRevision?: string;
  forceReclassify?: boolean;
  characterId?: string;
  voiceSettings?: VoiceSettings;
  identityDecisions?: CastArtifact["identityDecisions"];
  voiceModel?: string;
  language?: string;
  narratorDirection?: string;
}

export interface GenerationProcessSettings {
  chapterIds: string[];
  language?: string;
}

export interface StageSettings {
  extract: ExtractionProcessSettings;
  dialogue: DialogueSettings;
  review: Record<never, never>;
  cast: CastProcessSettings;
  generate: GenerationProcessSettings;
}

export interface ArtifactCandidate {
  revision: string;
  [key: string]: unknown;
}

export interface RawDialogueCandidate extends ArtifactCandidate {
  conflicts?: unknown[];
  correctedFromRevision?: string;
  strategy?: DialogueStrategy;
  attributionTargets?: DialogueAttributionTarget[];
  resultSummary?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  spans?: Array<Record<string, unknown>>;
  aiWindows?: Array<Record<string, unknown>>;
  matches?: Array<Record<string, unknown>>;
  blocks?: Array<Record<string, unknown>>;
  attributionChecks?: Array<Record<string, unknown>>;
  remoteAttributionChecks?: Array<Record<string, unknown>>;
  userCorrections?: Array<Record<string, unknown>>;
}

export interface ReviewCandidate extends ArtifactCandidate {
  warnings?: Array<Record<string, unknown>>;
  boundaryCandidates?: BoundaryCandidate[];
  recovery?: Record<string, unknown> | null;
}

export interface StageCandidate {
  extract: ArtifactCandidate;
  dialogue: RawDialogueCandidate;
  review: ReviewCandidate;
  cast: CastArtifact;
  generate: ArtifactCandidate;
}

export interface ReviewWarningDecision {
  occurrenceIds: string[];
  action: ReviewCapability;
  provenance: "user";
  previewToken?: unknown;
}

export interface BoundaryDecision {
  boundaryId: string;
  action: "chapter-start" | "not-a-boundary";
}

export interface DedicatedVoiceAcceptanceDecision {
  characterId: string;
  voiceRevision: string;
}

export interface VoiceSampleTranscript {
  text: string;
  language?: string | null;
}

export interface LayeredVoiceAcceptanceDecision {
  characterId: string;
  voiceRoute: Extract<VoiceRoute, { kind: "layered" }>;
}

export type AcceptanceDecision =
  | ReviewDecision
  | ReviewWarningDecision
  | BoundaryDecision
  | DedicatedVoiceAcceptanceDecision
  | LayeredVoiceAcceptanceDecision
  | { spanId: string; action: "speaker" | "narrator"; speakerLabel?: string; provenance: "user" };

/** Public application boundary. Hosted editions compose around this gateway. */
export interface WorkflowGateway {
  /** Optional media resolution for hosts and isolated previews; HTTP remains the default. */
  sourcePageImageUrl?(bookId: string, page: number): string;
  libraryCoverImageUrl?(exportId: string): string;
  layeredVoicePreviewUrl?(bookId: string, members: readonly { characterId: string; revision: string }[]): string;
  listBooks(): Promise<LocalBook[]>;
  deleteBook(bookId: string): Promise<void>;
  getRepresentativePages(bookId: string): Promise<RepresentativePage[]>;
  importBook(file: File): Promise<ImportResult>;
  getBookSnapshot(bookId: string): Promise<WizardSnapshot>;
  previewExtraction(bookId: string, page: number, method: ExtractionMethod): Promise<ExtractionPreview>;
  previewDialogue(bookId: string, settings: DialogueSettings): Promise<DialogueArtifact>;
  previewReviewBulk(bookId: string, revision: string, occurrenceId: string, action: ReviewCapability): Promise<Record<string, unknown>>;
  previewReviewTranscript(bookId: string, revision: string, page: number, policies: ReviewTranscriptPolicy[], occurrencePolicies?: ReviewTranscriptOccurrencePolicy[]): Promise<ReviewTranscriptPreview>;
  processStage<S extends ProcessableStage>(bookId: string, stage: S, settings: StageSettings[S]): Promise<Job>;
  previewCasting?(bookId: string, settings: CastProcessSettings): Promise<CastingPreview>;
  prepareRecordingScript(bookId: string): Promise<RecordingScriptArtifact>;
  splitRecordingScriptChapter(bookId: string, chapterId: string): Promise<RecordingScriptArtifact>;
  getStageCandidate<S extends ProcessableStage>(bookId: string, stage: S, revision: string): Promise<StageCandidate[S]>;
  transcribeVoiceSample(bookId: string, file: File): Promise<VoiceSampleTranscript>;
  uploadVoiceSample(bookId: string, castRevision: string, characterId: string, file: File, referenceText: string): Promise<CastArtifact>;
  deleteVoiceAudition(bookId: string, castRevision: string, characterId: string, voiceRevision: string): Promise<CastArtifact>;
  acceptStage(bookId: string, stage: ProcessableStage, revision: string, decisions?: AcceptanceDecision[]): Promise<void>;
  getJob(jobId: string): Promise<Job>;
  listBookJobs(bookId: string): Promise<Job[]>;
  cancelJob(jobId: string): Promise<Job>;
  openChapterAudio(bookId: string, chapterId: string, revision: string): Promise<void>;
  createM4bExport?(bookId: string, chapters: M4BExportChapter[], options?: M4BExportOptions): Promise<LibraryExport>;
  createAudioExport?(bookId: string, chapters: M4BExportChapter[], options: AudioExportOptions): Promise<LibraryExport>;
  exportM4b(bookId: string, chapters: M4BExportChapter[], options?: M4BExportOptions): Promise<M4BDownload>;
  listLibrary(): Promise<LibraryExport[]>;
  openLibraryExport(exportId: string): Promise<void>;
  revealLibraryExport(exportId: string): Promise<void>;
}

/** @deprecated Use WorkflowGateway. */
export type WizardApi = WorkflowGateway;
