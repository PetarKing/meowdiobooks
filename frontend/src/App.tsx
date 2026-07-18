import { useCallback, useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { normalizeDialogueArtifact, wizardApi as defaultWorkflowGateway } from "./api/client";
import { buildReviewWarningDecisions } from "./reviewDecisions";
import type {
  Book,
  CastArtifact,
  CastVoice,
  DialogueArtifact,
  DialogueAttributionRoute,
  DialogueAttributionTarget,
  DialogueConflict,
  DialogueConflictResolution,
  DialogueRegex,
  DialogueStructuralAction,
  DialogueStructuralIssue,
  DialogueStructuralResolution,
  DialogueStrategy,
  EnrichmentArtifact,
  ExtractionMethod,
  ExtractionPreview,
  Job,
  LibraryExport,
  LocalBook,
  RepresentativePage,
  ReviewCapability,
  ReviewTranscriptPreview,
  VoiceRoute,
  AcceptanceDecision,
  ProcessableStage,
  RawDialogueCandidate,
  ReviewCandidate,
  StageCandidate,
  StageSettings,
  WorkflowGateway,
  WizardSnapshot,
  WizardStage,
} from "./api/contracts";
import { Choice, Panel, Tag } from "./components/Ui";
import { strongConfirmationLabelsForCast, type IdentityDecision } from "./castIdentity";
import { CastIdentityReview } from "./components/CastIdentityReview";
import { CastVoiceReview } from "./components/CastVoiceReview";
import { confirmedVoiceRoutesForCast, voiceRoutesForCast } from "./voiceRoutes";
import { DialogueResultReview, type DialogueCorrectionDecision } from "./components/DialogueResultReview";
import { PhaseHelp } from "./components/PhaseHelp";
import { DialogueRoutingChoice } from "./components/DialogueRoutingChoice";
import { LanguageToggle } from "./components/LanguageToggle";
import heroArtwork from "./assets/brand/meowdiobooks-hero.png";
import brandMark from "./assets/brand/meowdiobooks-mark.png";
import catWizardArtwork from "./assets/illustrations/cat-wizard-workflow.png";
import {
  persistedSidebarCollapsed,
  productPaths,
  productViewFromPath,
  publicJourney,
  sidebarPreferenceKey,
  type JourneyDefinition,
  type JourneyStep,
  type JourneyStepId,
  type ProductView,
  type WizardStep,
} from "./workflow/navigation";
import {
  acceptedVoiceSelections,
  chosenVoiceRevision,
  decisionsForCast,
  defaultNarratorDirection,
  identityDecisionSignature,
  resolvedLabelsForCast,
  routeForVoice,
  summarizedVoiceNames,
  voiceHasRevision,
} from "./workflow/cast";
import {
  averageGenerationMultiplier,
  chapterDuration,
  estimatedListeningTime,
  generationDuration,
  generationSample,
  longChapterSplitSeconds,
  readyChapterCount,
  recentGenerationSamples,
  remainingGenerationTime,
  targetChapterPartSeconds,
  type GenerationRun,
  type GenerationSample,
} from "./workflow/generation";
import {
  availableAttributionTargets,
  candidateDialogue,
  dialogueRegexClaimCount,
  dialogueSettings,
  selectedAttributionCount,
  toggleTarget,
} from "./workflow/dialogue";
import {
  normalizeCandidateWarnings,
  reviewActionTitle,
  reviewConsequence,
  reviewDecisionActions,
  reviewGuidance,
  reviewQuestion,
  reviewWarningLabel,
} from "./workflow/review";
import {
  decodeImage,
  formatFileSize,
  formatLibraryChapters,
  formatLibraryDate,
  localizeErrorMessage,
  localizeProcessMessage,
  message,
  monogram,
} from "./workflow/presentation";

const emptyDialogue: DialogueArtifact = {
  regexes: [],
  openSpeakerPatterns: ["^\\?{2,}$", "^UNKNOWN$", "^Unidentified Voice$"],
  summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 },
  examples: [],
  conflicts: [],
  resolvedConflicts: [],
  conflictResolutions: [],
  structuralIssues: [],
  resolvedStructuralIssues: [],
  structuralResolutions: [],
  attributionTargets: ["unlabelled-candidates"],
};

const dialogueScanVersion = 6;

export interface AppProps {
  gateway?: WorkflowGateway;
  journey?: JourneyDefinition;
  stepOverrides?: Readonly<Record<JourneyStepId, ComponentType<WorkflowStepOverrideProps>>>;
  renderHeader?: (context: WorkflowHeaderContext) => ReactNode;
  renderLibraryActions?: (item: LibraryExport) => ReactNode;
  capabilities?: Partial<WorkflowCapabilities>;
}

export interface WorkflowCapabilities {
  localDialogueAttribution: boolean;
  showExecutionBadge: boolean;
  showProviderCostReceipts: boolean;
}

const publicWorkflowCapabilities: WorkflowCapabilities = {
  localDialogueAttribution: true,
  showExecutionBadge: true,
  showProviderCostReceipts: true,
};

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

function ProductTabIcon({ view }: { view: ProductView }) {
  if (view === "create") {
    return <svg className="product-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 4 5 5L9 20l-5-5L15 4Z" /><path d="m14 5 5 5M6 4v3M4.5 5.5h3M18 16v4M16 18h4" /></svg>;
  }
  if (view === "library") {
    return <svg className="product-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.5h5v14H4zM10 5.5h5v14h-5zM16.5 5l3.5-.8 2.6 13.6-3.5.8z" /></svg>;
  }
  return <svg className="product-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z" /></svg>;
}

export default function App({
  gateway = defaultWorkflowGateway,
  journey = publicJourney,
  stepOverrides = {},
  renderHeader,
  renderLibraryActions,
  capabilities: capabilityOverrides = {},
}: AppProps) {
  const capabilities = { ...publicWorkflowCapabilities, ...capabilityOverrides };
  const wizardApi = gateway;
  const stages = journey.steps;
  const stageIndex = (stageId: JourneyStepId) => journey.indexOf(stageId);
  const nextStage = (accepted: readonly WizardStage[]) => journey.next(accepted);
  const { t, i18n } = useTranslation();
  const uiLocale = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
  const [productView, setProductView] = useState<ProductView>(() => productViewFromPath(window.location.pathname));
  const [home, setHome] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(persistedSidebarCollapsed);
  const [snapshot, setSnapshot] = useState<WizardSnapshot>();
  const [books, setBooks] = useState<LocalBook[]>([]);
  const [libraryExports, setLibraryExports] = useState<LibraryExport[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [openingBookId, setOpeningBookId] = useState<string>();
  const [bookPendingDeletion, setBookPendingDeletion] = useState<LocalBook>();
  const [deletingBookId, setDeletingBookId] = useState<string>();
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [processingOverlaySuppressed, setProcessingOverlaySuppressed] = useState(false);
  const [error, setError] = useState<string>();
  const [activeJob, setActiveJob] = useState<Job>();
  const [extractionTransition, setExtractionTransition] = useState(false);
  const [reviewTransition, setReviewTransition] = useState(false);
  const [enrichmentTransition, setEnrichmentTransition] = useState(false);
  const [generationInProgress, setGenerationInProgress] = useState(false);
  const [generationRun, setGenerationRun] = useState<GenerationRun>();
  const [generationSamples, setGenerationSamples] = useState<GenerationSample[]>([]);
  const [progress, setProgress] = useState(0);
  const [processMessage, setProcessMessage] = useState("");

  const [representatives, setRepresentatives] = useState<RepresentativePage[]>([]);
  const [method, setMethod] = useState<ExtractionMethod>("liteparse");
  const [extractionPreview, setExtractionPreview] = useState<ExtractionPreview>();
  const [dialogue, setDialogue] = useState<DialogueArtifact>(emptyDialogue);
  const [dialogueStrategy, setDialogueStrategy] = useState<DialogueStrategy>("fill-gaps");
  const [attributionTargets, setAttributionTargets] = useState<DialogueAttributionTarget[]>(["unlabelled-candidates"]);
  const [dialogueCandidate, setDialogueCandidate] = useState<RawDialogueCandidate>();
  const [dialogueInitialDecisions, setDialogueInitialDecisions] = useState<DialogueCorrectionDecision[]>([]);
  const [editingAcceptedDialogue, setEditingAcceptedDialogue] = useState(false);
  const [conflictChoices, setConflictChoices] = useState<Record<string, string>>({});
  const [structuralChoices, setStructuralChoices] = useState<Record<string, DialogueStructuralAction>>({});
  const [dialogueRulesOpen, setDialogueRulesOpen] = useState(false);
  const [dialogueRouteChoiceOpen, setDialogueRouteChoiceOpen] = useState(false);
  const [dialogueProcessingRoute, setDialogueProcessingRoute] = useState<DialogueAttributionRoute>("local");
  const [dialogueLaunchPending, setDialogueLaunchPending] = useState(false);

  const [reviewCandidate, setReviewCandidate] = useState<ReviewCandidate>();
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewCapability>>({});
  const [boundaryDecisions, setBoundaryDecisions] = useState<Record<string, "chapter-start" | "not-a-boundary">>({});
  const [activeReviewGroup, setActiveReviewGroup] = useState<"chapters" | "warnings">("chapters");
  const [activeBoundary, setActiveBoundary] = useState(0);
  const [activeWarning, setActiveWarning] = useState(0);
  const [activeOccurrence, setActiveOccurrence] = useState(0);
  const [reviewFinalCheck, setReviewFinalCheck] = useState(false);
  const [reviewPreviewPage, setReviewPreviewPage] = useState(1);
  const [reviewTranscriptPreview, setReviewTranscriptPreview] = useState<ReviewTranscriptPreview>();
  const [reviewPreviewLoading, setReviewPreviewLoading] = useState(false);

  const [castCandidate, setCastCandidate] = useState<CastArtifact>();
  const [identityDecisions, setIdentityDecisions] = useState<Record<string, IdentityDecision>>({});
  const [resolvedLabels, setResolvedLabels] = useState<string[]>([]);
  const [voiceSelections, setVoiceSelections] = useState<Record<string, string>>({});
  const [voiceRoutes, setVoiceRoutes] = useState<Record<string, VoiceRoute>>({});
  const [confirmedVoiceRoutes, setConfirmedVoiceRoutes] = useState<Record<string, boolean>>({});
  const [voiceModel, setVoiceModel] = useState("");
  const [language, setLanguage] = useState("");
  const [narratorDirection, setNarratorDirection] = useState(defaultNarratorDirection);
  const [editingCast, setEditingCast] = useState(false);
  const [regeneratingCharacterId, setRegeneratingCharacterId] = useState<string>();
  const [uploadingCharacterId, setUploadingCharacterId] = useState<string>();
  const [deletingVoiceRevision, setDeletingVoiceRevision] = useState<string>();
  const [confirmDefaultVoices, setConfirmDefaultVoices] = useState(false);

  const [enrichmentCandidate, setEnrichmentCandidate] = useState<EnrichmentArtifact>();
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [chapterFilter, setChapterFilter] = useState<"all" | "pending" | "generated">("all");
  const [listeningChapterId, setListeningChapterId] = useState<string>();
  const [splitChapterId, setSplitChapterId] = useState<string>();
  const [exportChapterIds, setExportChapterIds] = useState<string[]>([]);
  const [exportTitle, setExportTitle] = useState("");
  const [exportAuthor, setExportAuthor] = useState("");
  const [exportCover, setExportCover] = useState<File>();
  const [exportCoverPage, setExportCoverPage] = useState(1);
  const [exportCoverPreviewUrl, setExportCoverPreviewUrl] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [revisingStages, setRevisingStages] = useState<string[]>([]);
  const libraryRequest = useRef<Promise<void> | undefined>(undefined);
  const reviewStripRef = useRef<HTMLDivElement | null>(null);
  const generationModalRef = useRef<HTMLDivElement | null>(null);

  const loadLibrary = useCallback(() => {
    if (libraryRequest.current) return libraryRequest.current;
    const request = gateway.listLibrary()
      .then(setLibraryExports)
      .catch((reason) => setError(message(reason)))
      .finally(() => {
        if (libraryRequest.current === request) libraryRequest.current = undefined;
        setLibraryReady(true);
      });
    libraryRequest.current = request;
    return request;
  }, [gateway]);

  const book = snapshot?.book;
  const completed = snapshot?.book.completedStages ?? [];
  const unlockedThrough = snapshot?.generatedChapters.some((row) => row.current)
    ? stageIndex("export")
    : snapshot ? Math.min(stageIndex("generate"), Math.max(0, nextStage(completed))) : 0;
  const hasDraft = (stageId?: WizardStep) => {
    if (stageId === "dialogue") return Boolean(dialogueCandidate) && !editingAcceptedDialogue;
    if (stageId === "review") return Boolean(reviewCandidate);
    if (stageId === "cast") return Boolean(castCandidate && castCandidate.revision !== snapshot?.cast?.revision);
    if (stageId === "enrich") return Boolean(enrichmentCandidate && enrichmentCandidate.revision !== snapshot?.enrichment?.revision);
    return false;
  };

  useEffect(() => {
    if (!exportCover) {
      setExportCoverPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(exportCover);
    setExportCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [exportCover]);

  useEffect(() => {
    if (!reviewFinalCheck || !book || !reviewCandidate?.revision) return;
    let disposed = false;
    setReviewPreviewLoading(true);
    const policies = Object.entries(reviewDecisions).map(([warningId, action]) => ({ warningId, action }));
    const timer = window.setTimeout(() => {
      void gateway.previewReviewTranscript(
        book.id,
        String(reviewCandidate.revision),
        reviewPreviewPage,
        policies,
      ).then(async (preview) => {
        if (disposed) return;
        await decodeImage(preview.imageUrl);
        if (!disposed) setReviewTranscriptPreview(preview);
      }).catch((reason) => {
        if (!disposed) {
          setReviewTranscriptPreview(undefined);
          setError(message(reason));
        }
      }).finally(() => {
        if (!disposed) setReviewPreviewLoading(false);
      });
    }, 80);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [book, gateway, reviewCandidate?.revision, reviewDecisions, reviewFinalCheck, reviewPreviewPage]);

  useEffect(() => {
    void gateway.listBooks().then(setBooks).catch(() => undefined);
    void loadLibrary();
  }, [gateway, loadLibrary]);

  useEffect(() => {
    if (!books.length) return;
    let disposed = false;
    void Promise.all(books.map((row) => gateway.listBookJobs(row.id).catch(() => [])))
      .then((rows) => {
        if (!disposed) setGenerationSamples(recentGenerationSamples(rows.flat()));
      });
    return () => { disposed = true; };
  }, [books, gateway]);

  useEffect(() => {
    const restoreProductView = () => {
      const next = productViewFromPath(window.location.pathname);
      setProductView(next);
      if (next === "library") void loadLibrary();
    };
    window.addEventListener("popstate", restoreProductView);
    return () => window.removeEventListener("popstate", restoreProductView);
  }, [loadLibrary]);

  useEffect(() => {
    const id = localStorage.getItem("meowdiobooks.activeJob");
    if (!id) return;
    setBusy(true);
    void gateway.getJob(id)
      .then(runJob)
      .then((job) => typeof job.result?.bookId === "string" ? hydrate(job.result.bookId) : undefined)
      .catch((reason) => setError(message(reason)))
      .finally(() => setBusy(false));
  // Reattach once per gateway; hydrate and runJob intentionally consume the current app state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.status)) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [activeJob]);

  useEffect(() => {
    if (!generationInProgress) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    generationModalRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [generationInProgress]);

  useEffect(() => {
    if (!listeningChapterId) return;
    const closePlayer = (event: KeyboardEvent) => {
      if (event.key === "Escape") setListeningChapterId(undefined);
    };
    window.addEventListener("keydown", closePlayer);
    return () => window.removeEventListener("keydown", closePlayer);
  }, [listeningChapterId]);

  async function hydrate(bookId: string) {
    let next = await gateway.getBookSnapshot(bookId);
    if (next.book.completedStages.includes("enrich") && !next.recordingScript) {
      await gateway.prepareRecordingScript(bookId);
      next = await gateway.getBookSnapshot(bookId);
      if (!next.recordingScript) throw new Error("Generate could not be prepared. Your approved work is unchanged.");
    }
    const pendingDialogueRevision = next.pendingCandidates?.dialogue?.revision;
    const pendingDialogue = pendingDialogueRevision
      ? await gateway.getStageCandidate(bookId, "dialogue", pendingDialogueRevision)
      : undefined;
    const pendingCastRevision = next.pendingCandidates?.cast?.revision;
    const pendingCast = pendingCastRevision
      ? await gateway.getStageCandidate(bookId, "cast", pendingCastRevision)
      : undefined;
    const hydratedDialogue = next.book.completedStages.includes("extract")
      && !next.book.completedStages.includes("dialogue")
      ? await gateway.previewDialogue(bookId, dialogueSettings(emptyDialogue, "fill-gaps"))
      : next.dialogue ?? emptyDialogue;
    const pendingDialoguePreview = normalizeDialogueArtifact(pendingDialogue);
    const pendingNeedsPreflight = Boolean(
      pendingDialoguePreview?.conflicts?.length || pendingDialoguePreview?.structuralIssues?.length,
    );
    const stalePreflightCandidate = pendingNeedsPreflight && pendingDialoguePreview?.scanVersion !== dialogueScanVersion;
    setSnapshot(next);
    setDialogue(pendingNeedsPreflight && !stalePreflightCandidate ? pendingDialoguePreview! : hydratedDialogue);
    setDialogueCandidate(pendingNeedsPreflight ? undefined : pendingDialogue);
    setDialogueInitialDecisions([]);
    setEditingAcceptedDialogue(false);
    setReviewCandidate(undefined);
    setReviewDecisions({});
    setBoundaryDecisions({});
    setReviewFinalCheck(false);
    setReviewPreviewPage(1);
    setReviewTranscriptPreview(undefined);
    setConflictChoices({});
    setStructuralChoices({});
    setDialogueRouteChoiceOpen(false);
    const restoredStrategy = pendingDialogue?.strategy as DialogueStrategy | undefined;
    const restoredTargets = pendingDialogue?.attributionTargets as DialogueAttributionTarget[] | undefined;
    setDialogueStrategy(restoredStrategy ?? hydratedDialogue.strategy ?? "fill-gaps");
    setAttributionTargets(restoredTargets ?? hydratedDialogue.attributionTargets ?? ["unlabelled-candidates"]);
    const restoredCast = pendingCast ?? next.cast;
    setCastCandidate(restoredCast);
    setVoiceSelections(acceptedVoiceSelections(restoredCast));
    setVoiceRoutes(voiceRoutesForCast(restoredCast));
    setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(restoredCast));
    if (restoredCast) {
      setIdentityDecisions(decisionsForCast(restoredCast));
      setResolvedLabels(resolvedLabelsForCast(restoredCast));
    }
    setNarratorDirection(restoredCast?.narrator?.voiceDirection ?? defaultNarratorDirection);
    setEnrichmentCandidate(next.enrichment);
    setListeningChapterId(undefined);
    setVoiceModel(restoredCast?.voiceModel ?? next.voiceSelection.modelId ?? next.voiceModels[0]?.id ?? "");
    const model = restoredCast?.voiceModel ?? next.voiceSelection.modelId ?? next.voiceModels[0]?.id;
    const supported = next.voiceModels.find((row) => row.id === model)?.supportedLanguages ?? [];
    const detected = restoredCast?.detectedLanguage;
    setLanguage(restoredCast?.language ?? next.voiceSelection.language ?? (detected && supported.includes(detected) ? detected : supported.includes("english") ? "english" : supported[0] ?? ""));
    setSelectedChapters((current) => {
      const unavailable = new Set(next.recordingScript?.summary.emptyChapterIds ?? []);
      const available = next.chapters.map((row) => row.id).filter((id) => !unavailable.has(id));
      const generated = new Set(next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
      const pending = available.filter((id) => !generated.has(id));
      return current.length ? current.filter((id) => pending.includes(id)) : pending;
    });
    setExportChapterIds((current) => {
      const playable = next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId);
      return current.length ? current.filter((id) => playable.includes(id)) : playable;
    });
    setExportTitle((current) => current || next.book.title || "");
    setExportAuthor((current) => current || next.book.author || "");
    return next;
  }

  async function runJob(initial: Job): Promise<Job> {
    let current = initial;
    setActiveJob(current);
    localStorage.setItem("meowdiobooks.activeJob", current.id);
    while (["queued", "running"].includes(current.status)) {
      setProgress(current.progress ?? 0);
      setProcessMessage(current.message ?? "");
      current = await gateway.getJob(current.id);
      setActiveJob(current);
      if (["queued", "running"].includes(current.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    }
    localStorage.removeItem("meowdiobooks.activeJob");
    setActiveJob(undefined);
    if (current.status !== "succeeded") throw new Error(current.error ?? `Job ${current.status}`);
    setProgress(100);
    return current;
  }

  async function processCandidate<S extends ProcessableStage>(stageId: S, settings: StageSettings[S], showProcessingOverlay = true): Promise<StageCandidate[S]> {
    if (!book) throw new Error("No book selected");
    setBusy(true);
    setProcessingOverlaySuppressed(!showProcessingOverlay);
    setError(undefined);
    try {
      const job = await runJob(await gateway.processStage(book.id, stageId, settings));
      const revision = String(job.result?.revision ?? "");
      if (!revision) throw new Error(`${stageId} did not return a candidate revision`);
      return await gateway.getStageCandidate(book.id, stageId, revision);
    } finally {
      setBusy(false);
      setProcessingOverlaySuppressed(false);
    }
  }

  async function continueWithoutEnrichment() {
    setEnrichmentTransition(true);
    setProcessMessage("Saving your production");
    setProgress(0);
    try {
      const candidate = await processCandidate("enrich", { skip: true }, false);
      setEnrichmentCandidate(candidate as unknown as EnrichmentArtifact);
      setProcessMessage("Opening Generate");
      setProgress(100);
      await acceptCandidate("enrich", candidate);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setEnrichmentTransition(false);
    }
  }

  async function acceptCandidate(stageId: ProcessableStage, candidate: { revision?: unknown; conflicts?: unknown[] } | undefined, decisions: AcceptanceDecision[] = []) {
    if (!book || !candidate?.revision) return;
    if (stageId === "dialogue" && candidate.conflicts?.length) {
      setError("Resolve every overlapping regex conflict before accepting Dialogue.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await gateway.acceptStage(book.id, stageId, String(candidate.revision), decisions);
      const next = await hydrate(book.id);
      if (stageId === "review") setReviewCandidate(undefined);
      setRevisingStages((current) => current.filter((row) => row !== stageId));
      setStage(Math.min(stageIndex("generate"), nextStage(next.book.completedStages)));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function processAndPublishExtraction() {
    if (!book) return;
    setExtractionTransition(true);
    setProcessMessage("Preparing complete extraction");
    setProgress(0);
    try {
      const candidate = await processCandidate("extract", { method });
      if (!candidate.revision) throw new Error("extract did not return a candidate revision");
      setBusy(true);
      setProcessMessage("Publishing extraction");
      setProgress(100);
      await gateway.acceptStage(book.id, "extract", String(candidate.revision), []);
      const next = await hydrate(book.id);
      setRevisingStages((current) => current.filter((row) => row !== "extract"));
      setStage(Math.min(stageIndex("generate"), nextStage(next.book.completedStages)));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      setExtractionTransition(false);
    }
  }

  async function importBook() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await gateway.importBook(file);
      const next = await hydrate(result.book.id);
      setRepresentatives(result.representativePages);
      const page = result.representativePages[0]?.page ?? 1;
      setExtractionPreview(await gateway.previewExtraction(result.book.id, page, method));
      setBooks((current) => [result.book, ...current.filter((row) => row.id !== result.book.id)]);
      setFile(undefined);
      setStage(nextStage(next.book.completedStages));
      setHome(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openBook(local: LocalBook) {
    setOpeningBookId(local.id);
    setBusy(true);
    setError(undefined);
    try {
      const next = await hydrate(local.id);
      const pages = await gateway.getRepresentativePages(local.id);
      setRepresentatives(pages);
      setExtractionPreview(await gateway.previewExtraction(local.id, pages[0]?.page ?? 1, method));
      setStage(nextStage(next.book.completedStages));
      setHome(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      setOpeningBookId(undefined);
    }
  }

  async function deleteBook(local: LocalBook) {
    setDeletingBookId(local.id);
    setError(undefined);
    try {
      await gateway.deleteBook(local.id);
      setBooks((current) => current.filter((row) => row.id !== local.id));
      setBookPendingDeletion(undefined);
    } catch (reason) {
      setError(message(reason));
      setBookPendingDeletion(undefined);
    } finally {
      setDeletingBookId(undefined);
    }
  }

  async function previewPage(page: number, selectedMethod = method) {
    if (!book) return;
    setBusy(true);
    try {
      setExtractionPreview(await gateway.previewExtraction(book.id, page, selectedMethod));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshDialogue(next = dialogue) {
    if (!book) return false;
    setBusy(true);
    try {
      setDialogue(await gateway.previewDialogue(book.id, dialogueSettings(next, dialogueStrategy)));
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function runDialogueTranscript(route: DialogueAttributionRoute) {
    setDialogueProcessingRoute(route);
    setDialogueLaunchPending(true);
    setProcessMessage("Preparing speaker check");
    setProgress(0);
    setDialogueRouteChoiceOpen(false);
    const targets = availableAttributionTargets(dialogue, attributionTargets);
    const settings = {
      ...dialogueSettings(dialogue, dialogueStrategy, targets),
      attributionRoute: route,
    };
    setDialogueInitialDecisions([]);
    setEditingAcceptedDialogue(false);
    void processCandidate("dialogue", settings)
      .then(setDialogueCandidate)
      .catch((reason) => setError(message(reason)))
      .finally(() => setDialogueLaunchPending(false));
  }

  async function reopenAcceptedDialogueReview() {
    const acceptedRevision = snapshot?.activeArtifacts.dialogue;
    if (!book || !acceptedRevision || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const accepted = await gateway.getStageCandidate(book.id, "dialogue", acceptedRevision);
      const baseRevision = accepted.correctedFromRevision || accepted.revision;
      const candidate = baseRevision === accepted.revision
        ? accepted
        : await gateway.getStageCandidate(book.id, "dialogue", baseRevision);
      setDialogueStrategy(candidate.strategy ?? accepted.strategy ?? dialogue.strategy ?? "fill-gaps");
      setAttributionTargets(candidate.attributionTargets ?? accepted.attributionTargets ?? dialogue.attributionTargets ?? ["unlabelled-candidates"]);
      setDialogueInitialDecisions(dialogueCorrections(accepted));
      setEditingAcceptedDialogue(true);
      setDialogueCandidate(candidate);
      setRevisingStages((current) => [...new Set([...current, "dialogue"])]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function requestDialogueTranscript() {
    if (!book || busy) return;
    let currentDialogue = dialogue;
    if (dialogueStrategy === "fill-gaps" && !currentDialogue.routing) {
      setBusy(true);
      try {
        currentDialogue = await gateway.previewDialogue(
          book.id,
          dialogueSettings(
            currentDialogue,
            dialogueStrategy,
            availableAttributionTargets(currentDialogue, attributionTargets),
          ),
        );
        setDialogue(currentDialogue);
      } catch (reason) {
        setError(message(reason));
        return;
      } finally {
        setBusy(false);
      }
    }
    const routing = currentDialogue.routing;
    if (dialogueStrategy === "fill-gaps" && !routing) {
      setError("Speaker-check choices could not be loaded. Try again.");
      return;
    }
    if (dialogueStrategy === "fill-gaps" && routing?.shouldPrompt && routing.remote && capabilities.localDialogueAttribution) {
      setDialogueRouteChoiceOpen(true);
      return;
    }
    if (dialogueStrategy === "fill-gaps" && !capabilities.localDialogueAttribution) {
      if (routing?.remote?.credentialConfigured) runDialogueTranscript("remote");
      else setError("Speaker-check choices could not be loaded. Try again.");
      return;
    }
    const preferred = routing?.defaultRoute === "remote" && routing.remote?.credentialConfigured
      ? "remote"
      : "local";
    runDialogueTranscript(preferred);
  }

  const activeJourneyStep = stages[stage];
  const builtinViews: Partial<Record<WizardStep, ReactNode>> = {
    extract: ExtractStage(),
    dialogue: DialogueStage(),
    review: ReviewStage(),
    cast: CastStage(),
    enrich: <EnrichmentStage key="enrich" />,
    generate: <GenerateStage key="generate" />,
    export: ExportStage(),
  };
  const StepOverride = activeJourneyStep ? stepOverrides[activeJourneyStep.id] : undefined;
  const createView = home
    ? <Home />
    : StepOverride && activeJourneyStep
      ? <StepOverride
          step={activeJourneyStep}
          gateway={gateway}
          book={book}
          snapshot={snapshot}
          completedStages={completed}
          busy={busy}
          refresh={async () => { if (book) await hydrate(book.id); }}
          navigateToStep={(stepId) => setStage(stageIndex(stepId))}
        />
      : activeJourneyStep?.builtin
        ? builtinViews[activeJourneyStep.builtin]
        : null;

  const view = productView === "create" ? createView : productView === "library" ? LibraryView() : <ComingSoonView />;
  const showWizard = productView === "create" && !home;
  const dialogueProcessing = dialogueLaunchPending || activeJob?.kind === "v2:dialogue";
  const generationReady = readyChapterCount(generationRun, activeJob, progress);
  const generationRemaining = remainingGenerationTime(generationRun, activeJob, progress);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(sidebarPreferenceKey, String(next));
      } catch {
        // The sidebar still works when browser storage is unavailable.
      }
      return next;
    });
  }

  return <div className="app-shell">
    {renderHeader ? renderHeader({ productView, libraryCount: libraryExports.length, navigate: navigateProduct }) : <header className="topbar" inert={generationInProgress || uploadingCharacterId ? true : undefined}>
      <div className="topbar-inner">
        <button className="brand" aria-label={t("Go to Home")} onClick={() => { navigateProduct("create"); setHome(true); }}>
          <span className="cat-mark"><img src={brandMark} alt="" /></span>
          <span>Meowdiobooks<small>{t("Books, finding their voice.")}</small></span>
        </button>
        <nav className="product-tabs" aria-label={t("Product areas")}>
          <button className={productView === "create" ? "active" : ""} onClick={() => navigateProduct("create")}><ProductTabIcon view="create" /><span className="product-tab-label">{t("Create")}</span></button>
          <button className={productView === "library" ? "active" : ""} aria-label={libraryExports.length ? t("Library, {{count}} audiobooks", { count: libraryExports.length }) : t("Library")} onClick={() => navigateProduct("library")}><ProductTabIcon view="library" /><span className="product-tab-label">{t("Library")}</span>{libraryExports.length > 0 && <small className="product-count" aria-hidden="true">{libraryExports.length}</small>}</button>
          <button className={productView === "player" ? "active" : ""} disabled><ProductTabIcon view="player" /><span className="product-tab-label">{t("Player")}</span><small className="product-soon">{t("Coming soon")}</small></button>
        </nav>
        <div className="topbar-actions">
          <LanguageToggle />
          {capabilities.showExecutionBadge && <div className="local-pill"><i /> {t("header.executionBadge", { ns: "edition" })}</div>}
        </div>
      </div>
    </header>}
    <div className={`workspace ${!showWizard ? "home-workspace" : ""} ${showWizard && sidebarCollapsed ? "rail-collapsed" : ""}`} inert={generationInProgress || uploadingCharacterId ? true : undefined}>
      {showWizard && <aside id="wizard-sidebar" className="rail">
        <button type="button" className="rail-toggle" aria-controls="wizard-sidebar" aria-expanded={!sidebarCollapsed} aria-label={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")} title={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span></button>
        <div className="book-mini"><div className="cover">{monogram(book?.title ?? "?")}</div><div><strong>{book?.title}</strong><span>{book?.filename}</span></div></div>
        <nav aria-label={t("Wizard stages")}>{stages.map((row, index) => { const done = Boolean(row.completionStage && completed.includes(row.completionStage)); const draft = hasDraft(row.builtin); const locked = index > unlockedThrough; const status = draft ? "Draft ready" : done ? "Complete" : locked ? "Generate audio first" : stage === index ? "In progress" : "Ready"; const label = t(row.label); const localizedStatus = t(status); return <button key={row.id} disabled={locked} aria-label={`${label} ${localizedStatus}`} title={sidebarCollapsed ? `${label} · ${localizedStatus}` : undefined} className={`${stage === index ? "active" : ""} ${done ? "done" : ""} ${draft ? "revising" : ""}`} onClick={() => setStage(index)}><b>{done ? "✓" : locked ? "·" : index + 1}</b><span><strong>{label}</strong><small>{localizedStatus}</small></span></button>; })}</nav>
        <figure className="workflow-familiar" aria-label={t("Your wizard cat companion")}>
          <img src={catWizardArtwork} alt={t("A cat wizard guiding a manuscript into dialogue and sound")} />
        </figure>
      </aside>}
      <main className={!showWizard ? "home-main" : stage <= stageIndex("review") ? "review-wide" : ""}>
        {error && <div className="error-note" role="alert">{localizeErrorMessage(error, t)}</div>}
        {view}
      </main>
    </div>
    {dialogueRouteChoiceOpen && dialogue.routing && <DialogueRoutingChoice routing={dialogue.routing} onChoose={runDialogueTranscript} onClose={() => setDialogueRouteChoiceOpen(false)} />}
    {(((activeJob || dialogueLaunchPending) && !processingOverlaySuppressed && stage !== stageIndex("generate")) || extractionTransition || reviewTransition || enrichmentTransition) && <div className="process-overlay" role="dialog" aria-label={t(dialogueProcessing && dialogueProcessingRoute === "remote" ? "processing.remoteDialogLabel" : "processing.dialogLabel", { ns: "edition" })} aria-modal="true"><div className={`process-modal ${enrichmentTransition ? "enrichment-transition-modal" : ""} ${dialogueProcessing ? "dialogue-processing-modal" : ""}`}><span className="eyebrow">{t(dialogueProcessing && dialogueProcessingRoute === "remote" ? "processing.remoteContextLabel" : "processing.contextLabel", { ns: "edition" })}</span><h2>{processMessage ? localizeProcessMessage(processMessage, t) : t("processing.fallbackMessage", { ns: "edition" })}</h2><div className={`processing-track determinate ${dialogueLaunchPending || activeJob?.status === "running" || extractionTransition || reviewTransition || enrichmentTransition ? "active" : ""}`} style={{ "--progress": `${progress}%` } as CSSProperties} role="progressbar" aria-label={t("Processing progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div><p>{reviewTransition ? t("Saving your choices and opening Cast & voices…") : enrichmentTransition ? t("Keeping your approved work intact and opening Generate…") : t("{{progress}}% complete · Accepted work stays unchanged.", { progress: Math.round(progress) })}</p>{activeJob?.status === "queued" && !enrichmentTransition && !dialogueProcessing && <button className="ghost" onClick={() => void wizardApi.cancelJob(activeJob.id)}>{t("Cancel queued job")}</button>}</div></div>}
    {uploadingCharacterId && <div className="process-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-clone-progress-title"><div className="process-modal"><span className="eyebrow">{t("processing.contextLabel", { ns: "edition" })}</span><h2 id="voice-clone-progress-title">{t("Creating cloned audition…")}</h2><div className="processing-track active" style={{ "--progress": "42%" } as CSSProperties} role="progressbar" aria-label={t("Cloned audition generation progress")}><i style={{ width: "42%" }} /></div><p>{t("voiceClone.progressDescription", { ns: "edition" })}</p></div></div>}
    {generationInProgress && <div className="process-overlay generation-overlay" role="dialog" aria-modal="true" aria-labelledby="generation-progress-title">
      <div ref={generationModalRef} className="process-modal generation-modal" tabIndex={-1}>
        <span className="eyebrow">{t("Making your audiobook")}</span>
        <h2 id="generation-progress-title">{t(progress >= 100 ? "Finishing your chapter audio…" : "Making your selected chapters…")}</h2>
        <div className={`processing-track determinate ${activeJob?.status === "running" ? "active" : ""}`} style={{ "--progress": `${progress}%` } as CSSProperties} role="progressbar" aria-label={t("Chapter generation progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
        <dl className="generation-progress-facts">
          <div><dt>{t("Chapters")}</dt><dd>{t("{{ready}} of {{total}} ready", { ready: generationReady, total: generationRun?.chapterIds.length ?? 0 })}</dd></div>
          <div><dt>{t("Remaining")}</dt><dd>{t(generationRemaining, { defaultValue: generationRemaining })}</dd></div>
        </dl>
        <p className="generation-modal-note">{t("processing.keepOpenNotice", { ns: "edition" })}</p>
        {activeJob?.status === "queued" && <button className="ghost" onClick={() => void wizardApi.cancelJob(activeJob.id)}>{t("Cancel queued job")}</button>}
      </div>
    </div>}
    {bookPendingDeletion && <div className="process-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-book-title"><div className="process-modal delete-book-modal"><span className="eyebrow">{t("books.deleteWorkingEyebrow", { ns: "edition" })}</span><h2 id="delete-book-title">{t("Delete “{{title}}”?", { title: bookPendingDeletion.title })}</h2><p>{t("books.deleteWorkingDescription", { ns: "edition" })}</p><p className="library-safe-note"><b>{t("Finished M4B audiobooks in Library stay exactly where they are.")}</b></p><div className="delete-book-actions"><button className="ghost" disabled={Boolean(deletingBookId)} onClick={() => setBookPendingDeletion(undefined)}>{t("Keep book")}</button><button className="danger" disabled={Boolean(deletingBookId)} onClick={() => void deleteBook(bookPendingDeletion)}>{t(deletingBookId ? "Deleting…" : "Delete working files")}</button></div></div></div>}
  </div>;

  function Home() {
    const localBooks = books.filter((row) => row.source_name);
    const totalAssetBytes = localBooks.reduce((total, row) => total + (row.asset_size_bytes ?? 0), 0);
    return <>
      <section className="welcome-hero"><img src={heroArtwork} alt={t("A cozy cat sound engineer narrating an enchanted open book")} /><div className="welcome-copy"><span className="eyebrow">{t("Your audiobook studio")}</span><h1>{t("Every book has")}<br />{t("a voice inside.")}</h1><p>{t("Turn a PDF into an audiobook, with control at every step.")}</p></div></section>
      <div className="home-flow">
        <section className={`quick-import ${file ? "has-file" : ""}`} aria-labelledby="quick-import-title">
          <div className="quick-import-copy"><span className="eyebrow">{t("New audiobook")}</span><h2 id="quick-import-title">{t(file ? "Ready to begin" : "Start another book")}</h2><p>{file ? t("books.importStorageNotice", { ns: "edition" }) : t("Add a PDF now; make the creative decisions step by step.")}</p></div>
          {file ? <div className="quick-import-ready"><div className="file-receipt"><span className="recent-cover">PDF</span><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button className="text-button" onClick={() => setFile(undefined)}>{t("Choose another")}</button></div><button className="primary" disabled={busy} onClick={() => void importBook()}>{t("Import PDF")} →</button></div> : <label className="quick-upload"><input type="file" accept=".pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0])} /><span className="quick-upload-icon" aria-hidden="true">↑</span><span><strong>{t("Choose PDF")}</strong><small>{t("PDF · up to 500 MB")}</small></span></label>}
        </section>
        {localBooks.length > 0 && <section className="wip-shelf"><Panel eyebrow={t("Work in progress")} title={t("books.workingTitle", { ns: "edition" })} actions={<div className="local-assets-summary"><b>{localBooks.length === 1 ? t("1 book") : t("{{count}} books", { count: localBooks.length })}</b><span>{t("{{size}} used", { size: formatFileSize(totalAssetBytes) })}</span></div>}><div className="recent-books">{localBooks.map((row) => { const opening = openingBookId === row.id; return <article key={row.id}><button className="recent-book-open" disabled={Boolean(openingBookId) || Boolean(deletingBookId)} aria-busy={opening} onClick={() => void openBook(row)}><span className="recent-cover">{monogram(row.title)}</span><span><strong>{row.title}</strong><small>{t("{{count}} pages · {{size}}", { count: row.page_count ?? "?", size: formatFileSize(row.asset_size_bytes ?? 0) })}</small></span><b className={opening ? "book-loading" : undefined}>{opening && <i aria-hidden="true" />} {t(opening ? "Opening…" : "Continue")} {!opening && "→"}</b></button><button className="recent-book-delete" aria-label={t("Delete {{title}}", { title: row.title })} disabled={Boolean(openingBookId) || Boolean(deletingBookId)} onClick={() => setBookPendingDeletion(row)}>{t("Delete")}</button></article>; })}</div></Panel></section>}
      </div>
    </>;
  }

  function LibraryView() {
    return <section className="library-page">
      <header className="library-head">
        <div className="library-head-copy"><span className="eyebrow">{t("The story made it")}</span><h1>{t("Your audiobooks")}</h1><p>{t("library.storageDescription", { ns: "edition" })}</p></div>
        <div className="library-finale" aria-hidden="true"><span className="library-finale-disc">♪</span><span className="library-finale-mark"><img src={brandMark} alt="" /></span></div>
        <span className="library-count">{!libraryReady ? t("Loading…") : libraryExports.length === 1 ? t("1 audiobook") : t("{{count}} audiobooks", { count: libraryExports.length })}</span>
      </header>
      {!libraryReady ? <LibrarySkeleton /> : libraryExports.length ? <div className="library-grid">{libraryExports.map((item) => <article key={item.id} className="library-book">
        <div className="library-cover"><span>{monogram(item.title)}</span><img src={`/api/library/${item.id}/cover`} alt={t("Cover of {{title}}", { title: item.title })} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /></div>
        <div className="library-book-copy"><h2>{item.title}</h2><p>{item.author}</p><div className="library-chapters"><b>{formatLibraryChapters(item, t)}</b></div><div className="library-meta"><span>{formatFileSize(item.sizeBytes)}</span><span>{formatLibraryDate(item.createdAt, uiLocale)}</span></div></div>
        <div className="library-actions">{renderLibraryActions ? renderLibraryActions(item) : <><button className="primary" onClick={() => void openLibraryItem(item.id)}>{t("library.openAction", { ns: "edition" })}</button><button className="ghost" onClick={() => void revealLibraryItem(item.id)}>{t("library.revealAction", { ns: "edition" })}</button></>}</div>
      </article>)}</div> : <div className="library-empty"><span aria-hidden="true">♪</span><h2>{t("No audiobooks yet.")}</h2><p>{t("Create an M4B in Export and it will appear here automatically.")}</p><button className="primary" onClick={() => navigateProduct("create")}>{t("Back to creating")} →</button></div>}
    </section>;
  }

  function LibrarySkeleton() {
    return <div className="library-grid library-skeleton-grid" aria-label={t("Loading audiobooks")} aria-busy="true">{[1, 2].map((item) => <article key={item} className="library-book library-skeleton" aria-hidden="true"><div className="library-cover" /><div className="library-book-copy"><span className="skeleton-line title" /><span className="skeleton-line author" /><div className="library-chapters"><span className="skeleton-line chapter" /></div><div className="library-meta"><span className="skeleton-line meta" /><span className="skeleton-line meta" /></div></div><div className="library-actions"><span /><span /></div></article>)}</div>;
  }

  function ComingSoonView() {
    return <section className="coming-soon-page">
      <div className="coming-soon-art"><img src={heroArtwork} alt="" /></div>
      <div className="coming-soon-copy">
        <span className="eyebrow">{t("Coming soon")}</span>
        <h1>{t("Your audiobook, ready to listen.")}</h1>
        <p>{t("player.description", { ns: "edition" })}</p>
        <div className="coming-soon-points">
          <span>✓ {t("A dedicated listening page")}</span><span>✓ {t("Chapter navigation and progress")}</span><span>✓ {t("player.remoteAccessPoint", { ns: "edition" })}</span>
        </div>
        <button className="primary" onClick={() => navigateProduct("create")}>{t("Back to creating")} →</button>
      </div>
    </section>;
  }

  function ExtractStage() {
    const page = extractionPreview?.page ?? 1;
    if (completed.includes("extract") && !revisingStages.includes("extract")) return <AcceptedSummary stage="extract" step={t("Step 1")} title={t("Extraction complete")} revision={snapshot?.activeArtifacts.extraction} onRevise={() => setRevisingStages([...new Set([...revisingStages, "extract"])])}><span><b>{book?.pageCount ?? "—"}</b><small>{t("Pages extracted")}</small></span><span><b>{t(methodLabel(method))}</b><small>{t("Selected parser")}</small></span><span><b>{t("Accepted")}</b><small>{t("Current result")}</small></span></AcceptedSummary>;
    return <><section className="extract-hero">
      <div className="extract-hero-copy"><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow><h1>{t("Did we read the source correctly?")}</h1><p>{t("Compare representative pages, choose one parser, then process the complete book.")}</p></div>
      <div className="extract-hero-art" aria-hidden="true"><span className="extract-page-card">PDF</span><span className="extract-spark">✦</span><span className="extract-text-card"><img src={brandMark} alt="" /><i /><i /><i /><i /></span></div>
    </section>
      {completed.includes("extract") && <Panel eyebrow={t("Accepted extraction")} title={t("Current extraction")} actions={<Tag tone="good">{t("Accepted")}</Tag>}><p className="panel-copy">{t("The accepted source blocks remain the only input to Dialogue. Running another extraction replaces that source after processing completes.")}</p></Panel>}
      <div className="choice-row extraction-choices">{(["liteparse", "native", "layout"] as ExtractionMethod[]).map((id) => <Choice key={id} selected={method === id} onClick={() => { setMethod(id); void previewPage(page, id); }} title={t(id === "liteparse" ? "LiteParse" : id === "native" ? "Native PDF text" : "Layout-aware")} badge={id === "liteparse" ? t("Recommended") : undefined} text={t(id === "liteparse" ? "Fast spatial parser" : id === "native" ? "Embedded text fallback" : "Slower layout-preserving fallback")} />)}</div>
      <div className="sample-reasons">{representatives.map((row) => <button key={row.page} className={row.page === page ? "selected" : ""} onClick={() => void previewPage(row.page)}><b>{t("p. {{page}}", { page: row.page })}</b><span>{t(row.reason, { defaultValue: row.reason })}</span></button>)}</div>
      <Panel title={t("Page {{page}} of {{count}}", { page, count: extractionPreview?.pageCount ?? book?.pageCount ?? "?" })}><PageComparison imageUrl={extractionPreview?.imageUrl} imageAlt={t("Original page {{page}}", { page })} rightLabel={t("{{method}} TEXT", { method: method.toUpperCase() })}><pre>{extractionPreview?.text}</pre></PageComparison></Panel>
      <div className="phase-action extract-final-action"><button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t("Process complete book")} →</button></div>
    </>;
  }

  function DialogueStage() {
    const successful = dialogue.regexes.filter((row) => row.matchCount > 0);
    const eligibleAttributionTargets = availableAttributionTargets(dialogue, attributionTargets);
    const unresolvedStructuralIssues = dialogue.structuralIssues ?? [];
    const resolvedStructuralIssues = dialogue.resolvedStructuralIssues ?? [];
    const unresolvedConflictGroups = groupDialogueConflicts(dialogue.conflicts ?? []);
    const resolvedConflictGroups = groupDialogueConflicts(dialogue.resolvedConflicts ?? []);
    const allConflictGroups = groupDialogueConflicts([...(dialogue.conflicts ?? []), ...(dialogue.resolvedConflicts ?? [])]);
    const result = dialogueCandidate ? candidateDialogue(dialogueCandidate, dialogue, dialogueStrategy) : undefined;
    const remoteCostReceipt = capabilities.showProviderCostReceipts && dialogue.remoteUsage
      ? `${dialogue.remoteUsage.modelDisplayName} · ≈${formatApiCost(dialogue.remoteUsage.estimatedCostUsd)} API`
      : undefined;
    const hasPreflightIssues = unresolvedStructuralIssues.length > 0 || unresolvedConflictGroups.length > 0;
    const conflictPairKey = (profileIds: [string, string]) => [...profileIds].sort().join("\u0000");
    function currentConflictResolutions() {
      const resolutions = new Map<string, DialogueConflictResolution>();
      for (const resolution of dialogue.conflictResolutions ?? []) resolutions.set(conflictPairKey(resolution.profileIds), resolution);
      for (const group of allConflictGroups) {
        const winnerProfileId = conflictChoices[group.groupId] ?? group.winnerProfileId;
        if (winnerProfileId) resolutions.set(conflictPairKey(group.profileIds), { profileIds: group.profileIds, winnerProfileId });
      }
      return [...resolutions.values()];
    }
    function currentStructuralResolutions() {
      const resolutions = new Map<string, DialogueStructuralResolution>();
      for (const resolution of dialogue.structuralResolutions ?? []) resolutions.set(resolution.issueId, resolution);
      for (const issue of [...unresolvedStructuralIssues, ...resolvedStructuralIssues]) {
        const action = structuralChoices[issue.id] ?? issue.selectedAction;
        if (action) resolutions.set(issue.id, { issueId: issue.id, action });
      }
      return [...resolutions.values()];
    }
    function updateRegex(id: string, update: Partial<DialogueRegex>) { const next = { ...dialogue, conflictResolutions: currentConflictResolutions(), structuralResolutions: currentStructuralResolutions(), regexes: dialogue.regexes.map((row) => row.id === id ? { ...row, ...update } : row) }; setConflictChoices({}); setStructuralChoices({}); setDialogue(next); void refreshDialogue(next); }
    function applyConflictResolutions() {
      const conflictResolutions = currentConflictResolutions();
      const resolvedPairs = new Set(conflictResolutions.map((row) => conflictPairKey(row.profileIds)));
      if (allConflictGroups.some((group) => !resolvedPairs.has(conflictPairKey(group.profileIds)))) return;
      const next = { ...dialogue, conflictResolutions };
      setConflictChoices({});
      setDialogue(next);
      void refreshDialogue(next);
    }
    function applyStructuralResolutions() {
      if (unresolvedStructuralIssues.some((issue) => !structuralChoices[issue.id])) return;
      const next = { ...dialogue, structuralResolutions: currentStructuralResolutions() };
      setStructuralChoices({});
      setDialogue(next);
      void refreshDialogue(next);
    }
    if (completed.includes("dialogue") && !dialogueCandidate && !revisingStages.includes("dialogue")) return <AcceptedSummary stage="dialogue" step={t("Step 2")} title={t("Transcript ready")} revision={snapshot?.activeArtifacts.dialogue} receipt={remoteCostReceipt} onRevise={() => void reopenAcceptedDialogueReview()}><span><b>{dialogue.summary.explicitTurns}</b><small>{t("Pre-labelled")}</small></span><span className="ai-contribution"><b>{dialogue.summary.aiContributions ?? 0}</b><small>{t("AI-assisted")} <em>{t("Kept after review")}</em></small></span><span><b>{dialogue.summary.userCorrected ?? 0}</b><small>{t("Corrected by you")}</small></span><span><b>{dialogue.summary.unresolved ?? 0}</b><small>{t("Narrator fallback")}</small></span></AcceptedSummary>;
    if (result) return <DialogueResultReview key={`${result.revision}:${editingAcceptedDialogue ? "accepted" : "candidate"}`} result={result} busy={busy} initialDecisions={dialogueInitialDecisions} requireChanges={editingAcceptedDialogue} onChangeStrategy={() => { setDialogueInitialDecisions([]); setEditingAcceptedDialogue(false); setDialogueCandidate(undefined); }} onAccept={(decisions) => void acceptCandidate("dialogue", dialogueCandidate, decisions.map((decision) => ({ ...decision })))}/>;
    return <><PageTitle stage="dialogue" step={t("Step 2")} title={t("Build the transcript")} copy={t("Review detected dialogue and decide who reads anything unresolved.")} />
      {!result && (hasPreflightIssues ? <div className="dialogue-stats conflict-stats"><span><b>{dialogueRegexClaimCount(dialogue)}</b><small>{t("regex interpretations")}</small></span><span className="warn"><b>{unresolvedStructuralIssues.length + dialogue.summary.conflicts}</b><small>{t("issues to review")}</small></span><span><b>{t("Pending")}</b><small>{t("AI scope after review")}</small></span></div> : <div className="dialogue-stats"><span><b>{dialogue.summary.totalTurns}</b><small>{t("turns found")}</small></span><span><b>{dialogue.summary.explicitTurns}</b><small>{t("pre-labelled turns")}</small></span><span className={dialogue.summary.openSpeakerTurns ? "warn" : "good"}><b>{dialogue.summary.openSpeakerTurns}</b><small>{t("unknown labels")}</small></span><span className={dialogue.summary.unlabeledCandidates ? "warn" : "good"}><b>{dialogue.summary.unlabeledCandidates}</b><small>{t("dialogue without labels")}</small></span></div>)}
      {!result && <><DialogueRulesSection regexes={dialogue.regexes} open={dialogueRulesOpen} strategy={dialogueStrategy} attributionTargets={attributionTargets} onToggle={() => setDialogueRulesOpen((open) => !open)} onToggleRegex={(id, enabled) => updateRegex(id, { enabled })} onAddRegex={async (regex) => { const next = { ...dialogue, regexes: [...dialogue.regexes, { id: `custom-${Date.now()}`, ...regex, priority: dialogue.regexes.length + 100, enabled: true, builtIn: false, matchCount: 0, examples: [] }] }; return refreshDialogue(next); }} onError={setError} /><UnknownSpeakerLabelsSection patterns={dialogue.openSpeakerPatterns} onRemove={(pattern) => { const next = { ...dialogue, openSpeakerPatterns: dialogue.openSpeakerPatterns.filter((row) => row !== pattern) }; setDialogue(next); void refreshDialogue(next); }} onAdd={(pattern) => { const next = { ...dialogue, openSpeakerPatterns: [...dialogue.openSpeakerPatterns, pattern] }; setDialogue(next); void refreshDialogue(next); }} /></>}
      {!result && !dialogueRulesOpen && unresolvedStructuralIssues.length > 0 && <DialogueStructuralReview issues={unresolvedStructuralIssues} choices={structuralChoices} onChoose={(issueId, action) => setStructuralChoices((current) => ({ ...current, [issueId]: action }))} onApply={applyStructuralResolutions} />}
      {!result && !dialogueRulesOpen && unresolvedStructuralIssues.length === 0 && unresolvedConflictGroups.length > 0 && <DialogueConflictReview groups={unresolvedConflictGroups} regexes={dialogue.regexes} choices={conflictChoices} onChoose={(groupId, profileId) => setConflictChoices((current) => ({ ...current, [groupId]: profileId }))} onReviewRules={() => setDialogueRulesOpen(true)} onApply={applyConflictResolutions} />}
      {!result && !dialogueRulesOpen && !hasPreflightIssues && <><ResolvedStructuralIssues issues={resolvedStructuralIssues} /><ResolvedDialogueConflicts groups={resolvedConflictGroups} regexes={dialogue.regexes} choices={conflictChoices} onChoose={(groupId, profileId) => setConflictChoices((current) => ({ ...current, [groupId]: profileId }))} onApply={applyConflictResolutions} /><Panel eyebrow={t("Unresolved dialogue")} title={t("Who should read detected dialogue without a speaker?")}><p className="panel-copy scope-intro">{t("AI speaker matching is optional. Use it when character voices matter; choose the narrator when the text is unclear.")}</p><div className="strategy-list two"><div className={`strategy-card ${dialogueStrategy === "fill-gaps" ? "selected" : ""}`} onClick={() => setDialogueStrategy("fill-gaps")}><button type="button" onClick={() => setDialogueStrategy("fill-gaps")}><strong>{t("Let AI identify selected speakers")}</strong><small>{t("Use nearby context to make a best-effort speaker guess. Existing speaker labels stay unchanged.")}</small></button><fieldset className="attribution-scopes" disabled={dialogueStrategy !== "fill-gaps"}><legend>{t("Choose what AI may identify")}</legend><label className={dialogue.summary.unlabeledCandidates === 0 ? "unavailable" : undefined}><input type="checkbox" disabled={dialogue.summary.unlabeledCandidates === 0} checked={eligibleAttributionTargets.includes("unlabelled-candidates")} onChange={() => setAttributionTargets(toggleTarget(attributionTargets, "unlabelled-candidates"))} /><span><b>{t("Dialogue with no speaker label")}</b><small><strong className={dialogue.summary.unlabeledCandidates ? "scope-count warn" : "scope-count good"}>{dialogue.summary.unlabeledCandidates} {t("turns")}</strong> {t("were detected as speech, but the source does not say who speaks.")}</small><span className="scope-example"><em>{t("Example")}</em><q>{t("I knew you would come.")}</q></span></span></label><label className={dialogue.summary.openSpeakerTurns === 0 ? "unavailable" : undefined}><input type="checkbox" disabled={dialogue.summary.openSpeakerTurns === 0} checked={eligibleAttributionTargets.includes("open-speakers")} onChange={() => setAttributionTargets(toggleTarget(attributionTargets, "open-speakers"))} /><span><b>{t("Dialogue labelled as unknown")}</b><small><strong className={dialogue.summary.openSpeakerTurns ? "scope-count warn" : "scope-count good"}>{dialogue.summary.openSpeakerTurns} {t("turns")}</strong> {t("have a label that explicitly means the speaker is unknown.")}</small><span className="scope-example"><em>{t("Example")}</em><q>{t("???: Who goes there?")}</q></span></span></label></fieldset></div><div className={`strategy-card ${dialogueStrategy === "narrate" ? "selected" : ""}`} onClick={() => setDialogueStrategy("narrate")}><button type="button" onClick={() => setDialogueStrategy("narrate")}><strong>{t("Use the narrator")}</strong><small>{t("Skip speaker attribution. Every unresolved span remains narrator-read.")}</small></button><div className="narrator-outcome"><b>{t("Predictable fallback")}</b><span>{t("No speaker guesses are made. Dialogue with an existing speaker label still keeps its assigned voice.")}</span></div></div></div><div className="dialogue-strategy-footer"><div className="strategy-consequence">{successful.length === 0 ? <><b>{t("No detected targets are available for AI attribution.")}</b><span>{t("Add a matching detection rule or continue with narrator-read source.")}</span></> : dialogueStrategy === "fill-gaps" ? <><b>{t("{{count}} detected turns will use AI.", { count: selectedAttributionCount(dialogue, eligibleAttributionTargets) })}</b><span>{t("{{unselected}} unselected turns will use the narrator; {{labelled}} pre-labelled turns stay unchanged.", { unselected: dialogue.summary.openSpeakerTurns + dialogue.summary.unlabeledCandidates - selectedAttributionCount(dialogue, eligibleAttributionTargets), labelled: dialogue.summary.explicitTurns })}</span></> : <><b>{t("No AI speaker matching will run.")}</b><span>{t("All unresolved detected material will be narrator-read.")}</span></>}</div><button className="primary" disabled={busy || (dialogueStrategy === "fill-gaps" && eligibleAttributionTargets.length === 0)} onClick={() => void requestDialogueTranscript()}>{t("Build transcript")} →</button></div></Panel></>}
    </>;
  }

  function ReviewStage() {
    const candidateWarnings = (reviewCandidate ? normalizeCandidateWarnings(reviewCandidate) : snapshot?.warnings ?? []).map((warning) => ({ ...warning, availableActions: reviewDecisionActions(warning) }));
    const boundaries = reviewCandidate && Array.isArray(reviewCandidate.boundaryCandidates) ? reviewCandidate.boundaryCandidates as WizardSnapshot["boundaryCandidates"] : snapshot?.boundaryCandidates ?? [];
    const warning = candidateWarnings[Math.min(activeWarning, Math.max(0, candidateWarnings.length - 1))];
    const occurrence = warning?.occurrences[Math.min(activeOccurrence, Math.max(0, warning.occurrences.length - 1))];
    const boundary = boundaries[Math.min(activeBoundary, Math.max(0, boundaries.length - 1))];
    const showingBoundary = boundaries.length > 0 && (activeReviewGroup === "chapters" || candidateWarnings.length === 0);
    const complete = candidateWarnings.every((row) => Boolean(reviewDecisions[row.id])) && boundaries.every((row) => Boolean(boundaryDecisions[row.id]));
    const totalGroups = candidateWarnings.length + (boundaries.length ? 1 : 0);
    const decidedGroups = candidateWarnings.filter((row) => Boolean(reviewDecisions[row.id])).length + (boundaries.length && boundaries.every((row) => Boolean(boundaryDecisions[row.id])) ? 1 : 0);
    const totalOccurrences = boundaries.length + candidateWarnings.reduce((total, row) => total + row.occurrences.length, 0);
    const decidedOccurrences = Object.keys(boundaryDecisions).filter((id) => boundaries.some((row) => row.id === id)).length + candidateWarnings.reduce((total, row) => total + (reviewDecisions[row.id] ? row.occurrences.length : 0), 0);

    function revealReviewGroup(group: string) {
      const target = reviewStripRef.current?.querySelector<HTMLElement>(`[data-review-group="${group}"]`);
      target?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
    }

    function openWarning(index: number) {
      setActiveReviewGroup("warnings");
      setActiveWarning(index);
      setActiveOccurrence(0);
      revealReviewGroup(`warning-${index}`);
    }

    function openBoundary(index: number) {
      setActiveReviewGroup("chapters");
      setActiveBoundary(index);
      revealReviewGroup("chapters");
    }

    function chooseBoundaryAction(boundaryId: string, action: "chapter-start" | "not-a-boundary") {
      const nextDecisions = { ...boundaryDecisions, [boundaryId]: action };
      setBoundaryDecisions(nextDecisions);
      if (boundaryDecisions[boundaryId]) return;
      const indices = [...boundaries.keys()];
      const nextBoundary = [...indices.slice(activeBoundary + 1), ...indices.slice(0, activeBoundary + 1)].find((index) => !nextDecisions[boundaries[index].id]);
      if (nextBoundary !== undefined) return setActiveBoundary(nextBoundary);
      const nextWarning = candidateWarnings.findIndex((row) => !reviewDecisions[row.id]);
      if (nextWarning >= 0) openWarning(nextWarning);
    }

    function acceptAllBoundaries() {
      setBoundaryDecisions(Object.fromEntries(boundaries.map((row) => [row.id, "chapter-start"] as const)));
      const nextWarning = candidateWarnings.findIndex((row) => !reviewDecisions[row.id]);
      if (nextWarning >= 0) openWarning(nextWarning);
    }

    function chooseReviewAction(warningId: string, action: ReviewCapability) {
      const nextDecisions = { ...reviewDecisions, [warningId]: action };
      setReviewDecisions(nextDecisions);
      setActiveOccurrence(0);

      if (reviewDecisions[warningId]) return;
      const currentIndex = candidateWarnings.findIndex((row) => row.id === warningId);
      const nextWarning = [
        ...candidateWarnings.slice(currentIndex + 1),
        ...candidateWarnings.slice(0, currentIndex),
      ].find((row) => !nextDecisions[row.id]);
      if (nextWarning) return openWarning(candidateWarnings.findIndex((row) => row.id === nextWarning.id));
      const nextBoundary = boundaries.findIndex((row) => !boundaryDecisions[row.id]);
      if (nextBoundary >= 0) openBoundary(nextBoundary);
    }

    function scrollReviewGroups(direction: -1 | 1) {
      reviewStripRef.current?.scrollBy({ left: direction * 280, behavior: "smooth" });
    }
    async function acceptReview() {
      if (!book || !reviewCandidate?.revision) return;
      setReviewTransition(true);
      setProcessMessage("Applying review decisions");
      setProgress(25);
      try {
        const decisions: AcceptanceDecision[] = [...await buildReviewWarningDecisions(
          book.id,
          String(reviewCandidate.revision),
          candidateWarnings,
          reviewDecisions,
          gateway.previewReviewBulk.bind(gateway),
        )];
        setProgress(60);
        decisions.push(...boundaries.map((row) => ({ boundaryId: row.id, action: boundaryDecisions[row.id] })));
        await acceptCandidate("review", reviewCandidate, decisions);
        setProgress(100);
      } finally {
        setReviewTransition(false);
      }
    }
    if (!reviewCandidate && completed.includes("review") && !revisingStages.includes("review")) return <AcceptedSummary stage="review" step={t("Step 3")} title={t("Review complete")} revision={snapshot?.activeArtifacts.review} onRevise={() => setRevisingStages([...new Set([...revisingStages, "review"])])}><span><b>{snapshot?.reviewInspection.decisions.length ?? 0}</b><small>{t("Issues resolved")}</small></span><span><b>{snapshot?.chapters.length ?? 0}</b><small>{t("Chapters confirmed")}</small></span><span><b>{t("Ready")}</b><small>{t("For cast & voices")}</small></span></AcceptedSummary>;
    if (!reviewCandidate) return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("Check for issues")} copy={t("Scan extraction, layout, chapter boundaries and delivery before choosing what happens.")} /><StageLaunch><button className="primary" disabled={busy} onClick={() => void processCandidate("review", {}, false).then((candidate) => { setReviewCandidate(candidate); setReviewDecisions({}); setBoundaryDecisions({}); setActiveBoundary(0); setActiveWarning(0); setActiveOccurrence(0); setActiveReviewGroup(Array.isArray(candidate.boundaryCandidates) && candidate.boundaryCandidates.length ? "chapters" : "warnings"); }).catch((reason) => setError(message(reason)))}>{t("Scan for issues")} →</button></StageLaunch></>;
    const recovery = reviewCandidate?.recovery;
    if (recovery) { const recoveryMessage = String(recovery.message ?? "Rebuild Dialogue before continuing."); return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("The transcript needs rebuilding before review.")} copy={t("Extraction completed successfully, but the transcript no longer maps back to every extracted character exactly.")} /><Panel eyebrow={t("Source safety check")} title={t("Nothing was lost or accepted incorrectly")} actions={<Tag tone="rose">{t("Needs rebuild")}</Tag>}><p className="panel-copy">{t(recoveryMessage, { defaultValue: recoveryMessage })}</p><div className="strategy-list two"><button className="strategy-card" onClick={() => { setRevisingStages([...new Set([...revisingStages, "dialogue"])]); setStage(stageIndex("dialogue")); }}><strong>{t("Rebuild Dialogue")}</strong><small>{t("Recommended. Keep the accepted extraction and create a fresh source-exact transcript.")}</small></button><button className="strategy-card" onClick={() => { setRevisingStages([...new Set([...revisingStages, "extract"])]); setStage(stageIndex("extract")); }}><strong>{t("Try another extraction")}</strong><small>{t("Use this only when the extracted words or reading order are themselves wrong.")}</small></button></div></Panel></>; }
    if (reviewFinalCheck) return <ReviewTranscriptFinalCheck
      preview={reviewTranscriptPreview}
      loading={reviewPreviewLoading}
      page={reviewPreviewPage}
      pageCount={reviewTranscriptPreview?.pageCount ?? book?.pageCount ?? 1}
      busy={busy || reviewTransition}
      onPageChange={setReviewPreviewPage}
      onBack={() => setReviewFinalCheck(false)}
      onAccept={() => void acceptReview().catch((reason) => setError(message(reason)))}
    />;
    return <>
      <PageTitle stage="review" step={t("Step 3 · Review")} title={t("Review the decisions that affect your audiobook.")} copy={t("Inspect the manuscript evidence, then decide exactly what happens. Nothing changes until you accept the review.")} />
      {totalGroups === 0 ? <section className="review-empty"><span aria-hidden="true">✓</span><h2>{t("No warning groups")}</h2><p>{t("No chapter boundaries or source issues need a decision.")}</p></section> : <>
        <div className="review-progress-line"><span>{t("{{decided}} of {{total}} review groups decided", { decided: decidedGroups, total: totalGroups })}</span><span>{t("{{decided}} of {{total}} anchored items reviewed", { decided: decidedOccurrences, total: totalOccurrences })}</span></div>
        <div className="review-group-nav">
          <button type="button" className="review-scroll-button previous" aria-label={t("Show previous review groups")} onClick={() => scrollReviewGroups(-1)}>‹</button>
          <nav className="review-strip" aria-label={t("Review groups")} ref={reviewStripRef}>
            {boundaries.length > 0 && <button data-review-group="chapters" className={[showingBoundary ? "active" : "", boundaries.every((row) => boundaryDecisions[row.id]) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openBoundary(activeBoundary)}><span>{boundaries.every((row) => boundaryDecisions[row.id]) ? "✓" : 1}</span><span><strong>{t("Chapter starts")}</strong><small>{t("{{count}} headings · structure", { count: boundaries.length })}</small></span></button>}
            {candidateWarnings.map((row, index) => <button key={row.id} data-review-group={`warning-${index}`} className={[!showingBoundary && index === activeWarning ? "active" : "", reviewDecisions[row.id] ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openWarning(index)}><span>{reviewDecisions[row.id] ? "✓" : index + (boundaries.length ? 2 : 1)}</span><span><strong>{t(reviewWarningLabel(row.kind))}</strong><small>{t("{{count}} occurrences · {{severity}}", { count: row.occurrences.length, severity: t(row.severity) })}</small></span></button>)}
          </nav>
          <button type="button" className="review-scroll-button next" aria-label={t("Show more review groups")} onClick={() => scrollReviewGroups(1)}>›</button>
        </div>
        <div className={["review-workspace", showingBoundary ? "chapter-workspace" : "warning-workspace"].join(" ")}>
          {showingBoundary && boundary ? <>
            <section className="review-evidence chapter-review-evidence">
              <div className="review-group-heading"><span><small>{t("Chapter boundary")}</small><h2>{t("Chapter starts")}</h2><p>{t("Confirm whether this detected heading begins a new audiobook chapter.")}</p></span><Tag tone="good">{t("Structure")}</Tag></div>
              <div className="occurrence-meta"><b>{t("Heading {{current}} of {{total}}", { current: activeBoundary + 1, total: boundaries.length })}</b><span>{t("Page {{page}}", { page: boundary.page })}</span></div>
              <div className="chapter-heading-evidence" aria-label={t("Chapter heading evidence")}><span>{t("Candidate heading")}</span><i aria-hidden="true">✦</i><h3>{boundary.source}</h3><p>{t(boundary.reason ?? "Detected from an explicit standalone chapter heading.", { defaultValue: boundary.reason ?? t("Detected from an explicit standalone chapter heading.") })}</p></div>
              <p className="evidence-help">{t("The heading text stays exactly as extracted. This choice only determines where the next audio chapter begins.")}</p>
              <div className="warning-nav"><button disabled={activeBoundary === 0} onClick={() => setActiveBoundary(activeBoundary - 1)}>← {t("Previous heading")}</button><button disabled={activeBoundary >= boundaries.length - 1} onClick={() => setActiveBoundary(activeBoundary + 1)}>{t("Next heading")} →</button></div>
            </section>
            <aside className="resolution-panel">
              <div className="review-scope"><b>{t("Applies to this heading only")}</b><small>{boundaries.length === 1 ? t("This is the only detected chapter heading.") : t("The other {{count}} candidates keep a separate decision.", { count: boundaries.length - 1 })}</small></div>
              <h3>{t("Does this heading start a new chapter?")}</h3>
              <div className="resolution-options" role="group" aria-label={t("Chapter decision for {{heading}}", { heading: boundary.source })}><button className={boundaryDecisions[boundary.id] === "chapter-start" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "chapter-start")}><b>{t("Start a new chapter")}</b><small>{t("Audio before this heading stays in the previous chapter.")}</small></button><button className={boundaryDecisions[boundary.id] === "not-a-boundary" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "not-a-boundary")}><b>{t("Keep inside the current chapter")}</b><small>{t("This heading will not create a chapter break.")}</small></button></div>
              {boundaryDecisions[boundary.id] && <div className="review-consequence"><b>{t("Consequence")}</b><span>{t(boundaryDecisions[boundary.id] === "chapter-start" ? "A new audio chapter begins at this exact heading." : "The heading stays inside the current audio chapter.")}</span></div>}
              {boundaries.length > 1 && !boundaries.every((row) => boundaryDecisions[row.id] === "chapter-start") && <div className="chapter-bulk-choice"><span><b>{t("Same decision for every heading?")}</b><small>{t("Mark all {{count}} detected headings as chapter starts. You can still change any one afterward.", { count: boundaries.length })}</small></span><button className="ghost review-bulk-button" onClick={acceptAllBoundaries}>{t("Mark all {{count}} as chapter starts", { count: boundaries.length })}</button></div>}
            </aside>
          </> : warning && occurrence ? <>
            <section className="review-evidence">
              <div className="review-group-heading"><span><small>{t("Source issue")}</small><h2>{t(reviewWarningLabel(warning.kind))}</h2><p>{t(reviewGuidance(warning), { defaultValue: reviewGuidance(warning) })}</p></span><Tag tone={warning.severity === "blocking" ? "rose" : "warn"}>{t(warning.severity)}</Tag></div>
              <div className="occurrence-meta"><b>{t("Example {{current}} of {{total}}", { current: activeOccurrence + 1, total: warning.occurrences.length })}</b><span>{t("Page {{page}}", { page: occurrence.page })}</span></div>
              <div className="source-window" aria-label={t("Manuscript context")}><div className="context-boundary">{t("Text immediately before")}</div>{occurrence.contextBefore ? <p className="context">{occurrence.contextBefore}</p> : <p className="context unavailable">{t("No preceding text in this extraction window.")}</p>}<p className="detected-span"><span>{t("Flagged text")}</span><mark>{occurrence.source || t("No text was extracted here")}</mark></p><div className="context-boundary">{t("Text immediately after")}</div>{occurrence.contextAfter ? <p className="context">{occurrence.contextAfter}</p> : <p className="context unavailable">{t("No following text in this extraction window.")}</p>}</div>
              <p className="evidence-help">{t("Only the highlighted text is affected. The surrounding text is shown for context and stays unchanged.")}</p>
              <div className="warning-nav"><button disabled={activeOccurrence === 0} onClick={() => setActiveOccurrence(activeOccurrence - 1)}>← {t("Previous example")}</button><button disabled={activeOccurrence >= warning.occurrences.length - 1} onClick={() => setActiveOccurrence(activeOccurrence + 1)}>{t("Next example")} →</button></div>
            </section>
            <aside className="resolution-panel">
              <div className="review-scope"><b>{t("Applies to all {{count}} occurrences in this group", { count: warning.occurrences.length })}</b><small>{t("Review each example on the left before choosing once.")}</small></div>
              <h3>{t(reviewQuestion(warning.kind))}</h3>
              <div className="resolution-options">{warning.availableActions.map((action) => <button key={action} className={reviewDecisions[warning.id] === action ? "selected" : ""} onClick={() => chooseReviewAction(warning.id, action)}><b>{t(reviewActionTitle(action, warning))}</b><small>{t(reviewConsequence(action, warning))}</small></button>)}</div>
              {reviewDecisions[warning.id] && <div className="review-consequence"><b>{t("Consequence")}</b><span>{t(reviewConsequence(reviewDecisions[warning.id], warning))}</span></div>}
            </aside>
          </> : null}
        </div>
      </>}
      <div className="phase-action"><span>{t("{{decided}} of {{total}} review groups decided", { decided: decidedGroups, total: totalGroups })}</span><button className="primary" disabled={!complete || busy} onClick={() => { setReviewPreviewPage(1); setReviewFinalCheck(true); }}>{t("Review complete transcript")} →</button></div>
    </>;
  }

  function CastStage() {
    const revising = revisingStages.includes("cast");
    const current = castCandidate ?? (revising ? undefined : snapshot?.cast);
    const hasPreviousCast = Boolean(snapshot?.cast)
      || (snapshot?.history.cast?.some((row) => row.status === "superseded") ?? false);

    function reclassifyCast() {
      if (!window.confirm(t("Reclassify source labels from the accepted Dialogue? Current draft cast edits will be replaced. Your accepted cast stays unchanged."))) return;
      void processCandidate("cast", { forceReclassify: true }).then((candidate) => {
        const cast = candidate as unknown as CastArtifact;
        setCastCandidate(cast);
        setIdentityDecisions(decisionsForCast(cast));
        setResolvedLabels(resolvedLabelsForCast(cast));
        setVoiceSelections({});
        setVoiceRoutes({});
        setConfirmedVoiceRoutes({});
        setNarratorDirection(defaultNarratorDirection);
        setEditingCast(false);
      }).catch((reason) => setError(message(reason)));
    }

    if (!current) return <><PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t(hasPreviousCast ? "Review your cast." : "Build your cast.")} copy={t(hasPreviousCast ? "Confirm your existing cast against the updated review." : "Find likely character matches, confirm the uncertain ones, then choose their voices.")} /><StageLaunch><button className="primary" onClick={() => void processCandidate("cast", {}, !hasPreviousCast).then((candidate) => {
      const cast = candidate as unknown as CastArtifact;
      setCastCandidate(cast);
      setIdentityDecisions(decisionsForCast(cast));
      setResolvedLabels(resolvedLabelsForCast(cast));
      setVoiceSelections(acceptedVoiceSelections(cast));
      setVoiceRoutes(voiceRoutesForCast(cast));
      setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast));
      setNarratorDirection(cast.narrator?.voiceDirection ?? defaultNarratorDirection);
      if (cast.voiceModel) setVoiceModel(cast.voiceModel);
      const modelId = cast.voiceModel ?? voiceModel;
      const supported = snapshot?.voiceModels.find((row) => row.id === modelId)?.supportedLanguages ?? [];
      if (cast.language && supported.includes(cast.language)) setLanguage(cast.language);
      else if (cast.detectedLanguage && supported.includes(cast.detectedLanguage)) setLanguage(cast.detectedLanguage);
    }).catch((reason) => setError(message(reason)))}>{t(hasPreviousCast ? "Review cast & voices" : "Find characters")} →</button></StageLaunch></>;
    if (completed.includes("cast") && !revising) { const voices = [current.narrator, ...(current.identities ?? [])].filter(Boolean); return <AcceptedSummary stage="cast" step={t("Step 4")} title={t("Cast and voices ready")} revision={snapshot?.activeArtifacts.cast} onRevise={() => { if (current.revision === snapshot?.cast?.revision) setCastCandidate(undefined); setRevisingStages([...new Set([...revisingStages, "cast"])]); }}><span><b>{voices.length}</b><small>{t("Assigned voices")}</small></span><span><b>{t(snapshot?.voiceSelection.language ?? "—")}</b><small>{t("Audition language")}</small></span><span><b>{snapshot?.voiceModels.find((row) => row.id === snapshot.voiceSelection.modelId)?.label ?? snapshot?.voiceSelection.modelId ?? "—"}</b><small>{t("Voice model")}</small></span></AcceptedSummary>; }
    if (current.phase === "identity-review" || editingCast) {
      const confirmationLabels = strongConfirmationLabelsForCast(current, identityDecisions);
      const pendingConfirmations = confirmationLabels.filter((label) => !resolvedLabels.includes(label));
      const castEditsDirty = identityDecisionSignature(identityDecisions) !== identityDecisionSignature(decisionsForCast(current))
        || voiceModel !== (current.voiceModel ?? voiceModel)
        || language !== (current.language ?? language);
      return <><PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t(editingCast ? "Review the cast." : "Build the cast.")} copy={t("Drag cast members together to merge, or onto Narrator to use its voice.")} />
        <CastIdentityReview cast={current} decisions={identityDecisions} setDecisions={setIdentityDecisions} resolvedLabels={resolvedLabels} setResolvedLabels={setResolvedLabels} voiceModels={snapshot?.voiceModels ?? []} voiceModel={voiceModel} language={language} onVoiceModelChange={(id) => { setVoiceModel(id); const supported = snapshot?.voiceModels.find((row) => row.id === id)?.supportedLanguages ?? []; if (!supported.includes(language)) setLanguage(supported.includes("english") ? "english" : supported[0] ?? ""); }} onLanguageChange={setLanguage} onReclassify={editingCast ? reclassifyCast : undefined} />
        <div className="phase-action cast-final-action"><span>{pendingConfirmations.length ? t("{{count}} cast labels still need confirmation", { count: pendingConfirmations.length }) : t(editingCast ? castEditsDirty ? "Unchanged auditions will be kept" : "No cast changes to apply" : "Cast structure is ready for auditions")}</span><div className="phase-action-buttons" role="group" aria-label={t("Cast edit actions")}>{editingCast && <button className="ghost" onClick={() => { setIdentityDecisions(decisionsForCast(current)); setResolvedLabels(resolvedLabelsForCast(current)); setVoiceModel(current.voiceModel ?? voiceModel); setLanguage(current.language ?? language); setNarratorDirection(current.narrator?.voiceDirection ?? narratorDirection); setEditingCast(false); }}>{t("Cancel cast edits")}</button>}<button className="primary" disabled={pendingConfirmations.length > 0 || !voiceModel || !language || (editingCast && !castEditsDirty)} onClick={() => void processCandidate("cast", { proposalRevision: current.revision, identityDecisions: Object.values(identityDecisions), voiceModel, language }).then((candidate) => { const cast = candidate as unknown as CastArtifact; const castVoices = [cast.narrator, ...(cast.identities ?? [])].filter(Boolean) as CastVoice[]; setCastCandidate(cast); setVoiceSelections((selected) => ({ ...acceptedVoiceSelections(cast), ...Object.fromEntries(castVoices.flatMap((voice) => voiceHasRevision(voice, selected[voice.characterId]) ? [[voice.characterId, selected[voice.characterId]]] : [])) })); setVoiceRoutes(voiceRoutesForCast(cast)); setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(cast)); setResolvedLabels(resolvedLabelsForCast(cast)); setNarratorDirection(cast.narrator?.voiceDirection ?? narratorDirection); setEditingCast(false); }).catch((reason) => setError(message(reason)))}>{t(editingCast ? "Apply cast edits" : "Generate required auditions")} →</button></div></div></>;
    }
    const voices = [current.narrator, ...(current.identities ?? [])].filter(Boolean) as CastVoice[];
    const voiceById = Object.fromEntries(voices.map((voice) => [voice.characterId, voice]));
    const layeredRouteReady = (voice: CastVoice) => {
      const route = routeForVoice(voice, voiceRoutes);
      return route.kind === "layered"
        && confirmedVoiceRoutes[voice.characterId] === true
        && route.characterIds.length >= 2
        && new Set(route.characterIds).size === route.characterIds.length
        && route.characterIds.every((id) => {
          const member = voiceById[id];
          return member?.category === "character" && Boolean(chosenVoiceRevision(member, voiceSelections));
        });
    };
    const unapprovedVoices = voices.filter((voice) => {
      const route = routeForVoice(voice, voiceRoutes);
      return route.kind === "layered"
        ? !layeredRouteReady(voice)
        : !voiceHasRevision(voice, voiceSelections[voice.characterId]);
    });
    const unavailableVoices = voices.filter((voice) => {
      const route = routeForVoice(voice, voiceRoutes);
      return route.kind === "layered"
        ? !layeredRouteReady(voice)
        : !chosenVoiceRevision(voice, voiceSelections);
    });
    const approvedCount = voices.length - unapprovedVoices.length;

    function submitCastVoices() {
      if (unavailableVoices.length) {
        setError("Every cast identity needs an available audition or a complete layered voice route before Cast & voices can be accepted.");
        return;
      }
      const decisions = voices.map((voice) => {
        const voiceRoute = routeForVoice(voice, voiceRoutes);
        return voiceRoute.kind === "layered"
          ? { characterId: voice.characterId, voiceRoute }
          : { characterId: voice.characterId, voiceRevision: chosenVoiceRevision(voice, voiceSelections)! };
      });
      setConfirmDefaultVoices(false);
      setVoiceSelections(Object.fromEntries(decisions.flatMap((decision) =>
        "voiceRevision" in decision && decision.voiceRevision
          ? [[decision.characterId, decision.voiceRevision]]
          : [],
      )));
      void acceptCandidate("cast", current, decisions);
    }

    function requestCastAcceptance() {
      if (unapprovedVoices.length) {
        setConfirmDefaultVoices(true);
        return;
      }
      submitCastVoices();
    }

    return <>
      <PageTitle stage="cast" step={t("Step 4 · Cast & voices")} title={t("Choose the cast voices.")} copy={t(current.reusedFromRevision ? "Dialogue is unchanged, so your previous cast and exact auditions were kept." : "Browse the cast, then open a character to generate, compare, and approve an exact audition.")} />
      <CastVoiceReview
        bookId={book?.id ?? ""}
        cast={current}
        selections={voiceSelections}
        routes={voiceRoutes}
        confirmedRoutes={confirmedVoiceRoutes}
        onRouteChange={(characterId, route) => {
          setVoiceRoutes((currentRoutes) => ({ ...currentRoutes, [characterId]: route }));
          setConfirmedVoiceRoutes((confirmed) => ({ ...confirmed, [characterId]: false }));
        }}
        onConfirmRoute={(characterId) => setConfirmedVoiceRoutes((confirmed) => ({ ...confirmed, [characterId]: true }))}
        onApprove={(characterId, revision) => setVoiceSelections((selected) => ({ ...selected, [characterId]: revision }))}
        regeneratingCharacterId={regeneratingCharacterId}
        uploadingCharacterId={uploadingCharacterId}
        deletingVoiceRevision={deletingVoiceRevision}
        onTranscribe={(file) => {
          if (!book) return Promise.reject(new Error("Book not found"));
          return gateway.transcribeVoiceSample(book.id, file);
        }}
        onUpload={(characterId, file, referenceText) => {
          if (!book) return;
          setUploadingCharacterId(characterId);
          setError(undefined);
          void gateway.uploadVoiceSample(book.id, current.revision, characterId, file, referenceText).then((cast) => {
            setCastCandidate(cast);
          }).catch((reason) => setError(message(reason))).finally(() => setUploadingCharacterId(undefined));
        }}
        onDelete={(characterId, voiceRevision) => {
          if (!book) return;
          setDeletingVoiceRevision(voiceRevision);
          setError(undefined);
          void gateway.deleteVoiceAudition(book.id, current.revision, characterId, voiceRevision).then((cast) => {
            const updatedVoice = [cast.narrator, ...(cast.identities ?? [])].find((row) => row?.characterId === characterId);
            setCastCandidate(cast);
            setVoiceSelections((selected) => {
              if (updatedVoice && voiceHasRevision(updatedVoice, selected[characterId])) return selected;
              const next = { ...selected };
              delete next[characterId];
              return next;
            });
          }).catch((reason) => setError(message(reason))).finally(() => setDeletingVoiceRevision(undefined));
        }}
        onRegenerate={(characterId, voiceSettings) => {
          setRegeneratingCharacterId(characterId);
          void processCandidate("cast", { proposalRevision: current.revision, characterId, voiceSettings }).then((candidate) => {
            const cast = candidate as unknown as CastArtifact;
            const regenerated = [cast.narrator, ...(cast.identities ?? [])].find((row) => row?.characterId === characterId);
            setCastCandidate(cast);
            setVoiceSelections((selected) => {
              const next = { ...selected };
              if (regenerated && !voiceHasRevision(regenerated, selected[characterId])) delete next[characterId];
              return next;
            });
          }).catch((reason) => setError(message(reason))).finally(() => setRegeneratingCharacterId(undefined));
        }}
      />
      <div className="phase-action">
        <span>{t("{{approved}} of {{total}} approved", { approved: approvedCount, total: voices.length })}</span>
        <div className="phase-action-buttons" role="group" aria-label={t("Cast voice actions")}>
          <button className="ghost" onClick={() => setEditingCast(true)}>← {t(current.reusedFromRevision ? "Review cast" : "Edit cast")}</button>
          <button className="primary" disabled={busy || unavailableVoices.length > 0} onClick={requestCastAcceptance}>{t("Accept cast & voices")} →</button>
        </div>
      </div>
      {confirmDefaultVoices && <div className="process-overlay" role="dialog" aria-modal="true" aria-labelledby="default-voices-title">
        <div className="process-modal cast-default-modal">
          <span className="eyebrow">{t("Unapproved voices")}</span>
          <h2 id="default-voices-title">{unapprovedVoices.length === 1 ? t("1 voice will use default audition") : t("{{count}} voices will use default auditions", { count: unapprovedVoices.length })}</h2>
          <p>{unapprovedVoices.length === 1 ? t("{{name}} has no approved audition. Its latest audition will be selected.", { name: summarizedVoiceNames(unapprovedVoices) }) : t("{{names}} have no approved audition. The latest audition for each will be selected.", { names: summarizedVoiceNames(unapprovedVoices) })}</p>
          {approvedCount > 0 && <p>{approvedCount === 1 ? t("Your 1 approved choice stays exactly as selected.") : t("Your {{count}} approved choices stay exactly as selected.", { count: approvedCount })}</p>}
          <div className="cast-default-actions">
            <button className="ghost" autoFocus onClick={() => setConfirmDefaultVoices(false)}>{t("Keep reviewing")}</button>
            <button className="primary" onClick={submitCastVoices}>{t("Use defaults and accept")} →</button>
          </div>
        </div>
      </div>}
    </>;
  }

  function EnrichmentStage() {
    const revising = revisingStages.includes("enrich");
    const current = enrichmentCandidate ?? (revising ? undefined : snapshot?.enrichment);
    if (current && completed.includes("enrich") && !revising) return <AcceptedSummary stage="enrich" step={t("Step 5 · Coming soon")} title={t("Continued without enrichment")} revision={snapshot?.activeArtifacts.enrichment} onRevise={() => { setEnrichmentCandidate(undefined); setRevisingStages([...new Set([...revisingStages, "enrich"])]); }}><span><b>{t("Skipped")}</b><small>{t("Current behavior")}</small></span><span><b>0</b><small>{t("Book changes")}</small></span><span><b>{t("Ready")}</b><small>{t("For generation")}</small></span></AcceptedSummary>;
    if (current) return <><PageTitle stage="enrich" step={t("Step 5 · Enrich")} title={t("Continue with the original performance.")} copy={t("No text, speaker, identity, voice, or audio will change.")} /><StageLaunch><button className="primary" onClick={() => void acceptCandidate("enrich", current)}>{t("Continue")} →</button></StageLaunch></>;
    const voices = [snapshot?.cast?.narrator, ...(snapshot?.cast?.identities ?? [])].filter((voice): voice is CastVoice => Boolean(voice));
    const auditions = voices.reduce((total, voice) => total + (voice.voiceCandidates?.length ?? (voice.voicePreviewRevision ? 1 : 0)), 0);
    const castProfiles = snapshot?.cast?.proposals.length ?? 0;
    const castMetric = voices.length || castProfiles;
    const characters = (snapshot?.chapters ?? []).reduce((total, chapter) => total + (chapter.estimatedCharacters ?? 0), 0);
    const turns = snapshot?.dialogue?.summary.totalTurns ?? voices.reduce((total, voice) => total + (voice.lineCount ?? 0), 0);
    const aiAttributed = snapshot?.dialogue?.summary.aiAttributed;
    return <section className="enrichment-celebration" aria-labelledby="enrichment-recap-title">
        <div className="enrichment-recap">
          <StepEyebrow stage="enrich">{t("Step 5 · Your production so far")}</StepEyebrow>
          <h2 id="enrichment-recap-title">{t("The hard creative decisions are done.")}</h2>
          <p>{t("Your transcript is shaped, your cast decisions are captured, and the production is ready for its final listening script.")}</p>
          <div className="enrichment-stats" aria-label={t("Production summary")}>
            <span><b>{turns.toLocaleString(uiLocale)}</b><small>{t("Spoken lines")}</small><em>{aiAttributed === undefined ? t("AI attribution not recorded") : t("{{count}} attributed with AI", { count: aiAttributed.toLocaleString(uiLocale) })}</em></span>
            <span><b>{castMetric.toLocaleString(uiLocale)}</b><small>{t(voices.length ? "Voices cast" : "Cast roles shaped")}</small><em>{voices.length ? t("{{count}} AI auditions", { count: auditions.toLocaleString(uiLocale) }) : t("AI-assisted profiles")}</em></span>
            <span><b>{(snapshot?.chapters.length ?? 0).toLocaleString(uiLocale)}</b><small>{t("Chapters prepared")}</small><em>{characters ? t("{{count}} characters to perform", { count: characters.toLocaleString(uiLocale) }) : t("Length estimate pending")}</em></span>
            <span className="runtime"><b>{estimatedListeningTime(characters, t)}</b><small>{t("Estimated audiobook")}</small><em>{t("Based on the prepared script")}</em></span>
          </div>
        </div>
        <div className="enrichment-future">
          <div className="enrichment-future-copy">
            <span className="eyebrow">{t("Enrichment preview")}</span>
            <h2>{t("Coming soon: bring the player to life.")}</h2>
            <p><b>{t("These features are not available yet.")}</b> {t("When released, enrichment will layer sound and visual direction over your approved performance—without rewriting it.")}</p>
            <div className="future-feature-grid" aria-label={t("Coming soon features")}>
              <article><header><span>01</span><small>{t("Coming soon")}</small></header><div className="scene-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><b>{t("Scene effects")}</b><small>{t("Atmosphere, environmental sound and dramatic cues that respond inside the player.")}</small></article>
              <article><header><span>02</span><small>{t("Coming soon")}</small></header><div className="character-states" aria-hidden="true"><span>{t("calm")}</span><span>{t("tense")}</span><span>{t("joy")}</span></div><b>{t("Character states")}</b><small>{t("Expressions and animation states that follow the emotional beat of each line.")}</small></article>
              <article><header><span>03</span><small>{t("Coming soon")}</small></header><div className="avatar-stack" aria-hidden="true"><span><img src={brandMark} alt="" /></span><span><img src={brandMark} alt="" /></span><span><img src={brandMark} alt="" /></span></div><b>{t("Character avatars")}</b><small>{t("Distinct visual identities that let listeners recognize every voice at a glance.")}</small></article>
            </div>
          </div>
        </div>
        <div className="enrichment-ready">
          <div><span className="enrichment-spark" aria-hidden="true">✓</span><span><b>{t("Everything you approved stays locked.")}</b><small>{t("Nothing extra will be added yet. Continue to prepare the listening script.")}</small></span></div>
          <button className="primary" disabled={busy} onClick={() => void continueWithoutEnrichment()}>{t("Continue to Generate")} →</button>
        </div>
      </section>;
  }

  function GenerateStage() {
    if (!snapshot?.recordingScript) return null;
    const generated = snapshot?.generatedChapters ?? [];
    const chapters = snapshot?.chapters ?? [];
    const scriptChapters = new Map(snapshot.recordingScript.summary.chapters.map((row) => [row.chapterId, row]));
    const unavailableChapters = new Set(snapshot.recordingScript.summary.emptyChapterIds);
    const generatedByChapter = new Map(generated.map((row) => [row.chapterId, row]));
    const availableChapters = chapters.filter((chapter) => !unavailableChapters.has(chapter.id));
    const currentGenerated = generated.filter((row) => row.current);
    const historicalMultiplier = averageGenerationMultiplier(generationSamples);
    const remainingAudioSeconds = availableChapters
      .filter((chapter) => !generatedByChapter.get(chapter.id)?.current)
      .reduce((total, chapter) => total + (scriptChapters.get(chapter.id)?.estimatedSeconds ?? (chapter.estimatedCharacters ?? 0) / 15), 0);
    const selectedAudioSeconds = chapters
      .filter((chapter) => selectedChapters.includes(chapter.id))
      .reduce((total, chapter) => total + (scriptChapters.get(chapter.id)?.estimatedSeconds ?? (chapter.estimatedCharacters ?? 0) / 15), 0);
    const visibleChapters = chapters.filter((chapter) => {
      const playable = generatedByChapter.get(chapter.id);
      if (chapterFilter === "pending") return !playable?.current && !unavailableChapters.has(chapter.id);
      if (chapterFilter === "generated") return Boolean(playable);
      return true;
    });
    const visibleAvailableChapterIds = visibleChapters.filter((chapter) => !unavailableChapters.has(chapter.id)).map((chapter) => chapter.id);
    const coverUrl = book ? `/api/books/${book.id}/pages/1/image` : undefined;
    const filterCounts = {
      all: chapters.length,
      pending: availableChapters.filter((chapter) => !generatedByChapter.get(chapter.id)?.current).length,
      generated: generated.length,
    };
    const listeningChapter = listeningChapterId ? chapters.find((chapter) => chapter.id === listeningChapterId) : undefined;
    const listeningAudio = listeningChapter ? generatedByChapter.get(listeningChapter.id) : undefined;
    const selectedLongChapter = selectedChapters.length === 1
      ? chapters.find((chapter) => chapter.id === selectedChapters[0])
      : undefined;
    const selectedLongSeconds = selectedLongChapter
      ? scriptChapters.get(selectedLongChapter.id)?.estimatedSeconds ?? (selectedLongChapter.estimatedCharacters ?? 0) / 15
      : 0;
    const canSplitSelectedChapter = Boolean(
      selectedLongChapter
      && !selectedLongChapter.splitFrom
      && selectedLongSeconds >= longChapterSplitSeconds
      && !generatedByChapter.get(selectedLongChapter.id)?.current,
    );
    const splitChapter = splitChapterId ? chapters.find((chapter) => chapter.id === splitChapterId) : undefined;
    const splitSeconds = splitChapter
      ? scriptChapters.get(splitChapter.id)?.estimatedSeconds ?? (splitChapter.estimatedCharacters ?? 0) / 15
      : 0;
    const proposedPartCount = Math.max(2, Math.ceil(splitSeconds / targetChapterPartSeconds));
    const selectFilter = (filter: typeof chapterFilter) => {
      setChapterFilter(filter);
      setSelectedChapters([]);
    };
    return <>
      <section className="generate-hero">
        <div className="generate-cover-stack" aria-hidden="true">
          <span />
          <span />
          {coverUrl && <img src={coverUrl} alt="" />}
        </div>
        <div className="generate-hero-copy">
          <StepEyebrow stage="generate">{t("Step 6 · Generate")}</StepEyebrow>
          <h1>{t("Bring every chapter to life.")}</h1>
          <p>{t("Each selected chapter becomes its own audio track to review before export.")}</p>
        </div>
        <div className="generate-hero-state"><dl className="generate-hero-stats">
            <div><dt>{t("Playable")}</dt><dd>{currentGenerated.length} <small>{t("of {{count}}", { count: availableChapters.length })}</small></dd></div>
            <div><dt>{t("Audio to make")}</dt><dd>{chapterDuration(remainingAudioSeconds)}</dd></div>
            <div><dt>{t("Still to make")}</dt><dd>{filterCounts.pending} <small>{t("chapters")}</small></dd></div>
          </dl></div>
      </section>

      <section className="chapter-library" aria-label={t("Chapters")}>
        <div className="chapter-library-toolbar">
          <div className="chapter-filter-tabs" role="tablist" aria-label={t("Filter chapters")}>
            <button type="button" role="tab" aria-selected={chapterFilter === "all"} onClick={() => selectFilter("all")}>{t("All")} <small>{filterCounts.all}</small></button>
            <button type="button" role="tab" aria-selected={chapterFilter === "pending"} onClick={() => selectFilter("pending")}>{t("To make")} <small>{filterCounts.pending}</small></button>
            <button type="button" role="tab" aria-selected={chapterFilter === "generated"} onClick={() => selectFilter("generated")}>{t("Generated")} <small>{filterCounts.generated}</small></button>
          </div>
          <div className="chapter-library-controls">
            <span>{t("{{count}} shown", { count: visibleChapters.length })}</span>
            <button type="button" onClick={() => setSelectedChapters(visibleAvailableChapterIds)}>{t("Select all shown")}</button>
            <button type="button" disabled={!selectedChapters.length} onClick={() => setSelectedChapters([])}>{t("Clear")}</button>
          </div>
        </div>
        <div className={`chapter-card-grid ${selectedChapters.length ? "has-selection" : ""}`}>{visibleChapters.map((row) => {
          const playable = generatedByChapter.get(row.id);
          const unavailable = unavailableChapters.has(row.id);
          const selected = !unavailable && selectedChapters.includes(row.id);
          const chapterNumber = chapters.findIndex((chapter) => chapter.id === row.id) + 1;
          const nextChapter = chapters[chapterNumber];
          const inferredEndPage = row.endPage ?? (nextChapter?.startPage ? nextChapter.startPage - 1 : snapshot?.book.pageCount);
          const pageRange = row.startPage ? t("Pages {{start}}–{{end}}", { start: row.startPage, end: Math.max(row.startPage, inferredEndPage ?? row.startPage) }) : undefined;
          const estimatedSeconds = scriptChapters.get(row.id)?.estimatedSeconds ?? (row.estimatedCharacters ?? 0) / 15;
          const audioSeconds = playable?.audioSeconds ?? estimatedSeconds;
          return <article key={row.id} className={`chapter-card ${selected ? "selected" : ""} ${playable?.current ? "generated" : ""} ${playable ? "has-audio" : ""} ${playable && !playable.current ? "stale" : ""} ${unavailable ? "unavailable" : ""}`}>
            <label className="chapter-select">
              <input aria-label={t("Select {{title}}", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} type="checkbox" disabled={unavailable} checked={selected} onChange={(event) => setSelectedChapters(event.target.checked ? [...new Set([...selectedChapters, row.id])] : selectedChapters.filter((id) => id !== row.id))} />
            </label>
            <div className="chapter-book-mark">
              <span aria-hidden="true">{t("Chapter")}</span><b aria-hidden="true">{String(chapterNumber).padStart(2, "0")}</b>
              {playable && <button type="button" className="chapter-listen" aria-label={t(playable.current ? "Listen to {{title}}" : "Listen to {{title}} (older recording)", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} onClick={() => setListeningChapterId(row.id)}>▶</button>}
            </div>
            <div className="chapter-card-body">
              <h3>{row.title || t("Chapter {{number}}", { number: chapterNumber })}</h3>
              <div className="chapter-card-meta">{pageRange && <small>{pageRange}</small>}{playable && !playable.current && <span className="chapter-stale-label">{t("Stale")}</span>}</div>
            </div>
            <dl className="chapter-estimates"><div><dt>{t("Audio")}</dt><dd>{unavailable ? t("No audio") : chapterDuration(audioSeconds, !playable?.audioSeconds)}</dd></div><div><dt>{t("Make")}</dt><dd>{unavailable ? t("Not needed") : generationDuration(estimatedSeconds, historicalMultiplier)}</dd></div></dl>
          </article>;
        })}</div>
        {!visibleChapters.length && <div className="chapter-filter-empty"><span aria-hidden="true">♪</span><b>{t("No chapters in this view.")}</b><small>{t("Choose another filter to see the rest of the book.")}</small></div>}
        {(availableChapters.length > 0 || currentGenerated.length > 0) && <section className="generation-selection" aria-label={t("Generation action")}>
          <div className="generation-selection-copy"><span className="selection-spark" aria-hidden="true">{selectedChapters.length ? "✦" : "♪"}</span><b>{selectedChapters.length ? selectedChapters.length === 1 ? t("1 chapter selected") : t("{{count}} chapters selected", { count: selectedChapters.length }) : currentGenerated.length ? t("{{count}} chapters are ready", { count: currentGenerated.length }) : t("Choose chapters to generate")}</b></div>
          {selectedChapters.length > 0 && <dl><div><dt>{t("Listening")}</dt><dd>{chapterDuration(selectedAudioSeconds)}</dd></div><div><dt>{t("Generation")}</dt><dd>{generationDuration(selectedAudioSeconds, historicalMultiplier)}</dd></div></dl>}
          <div className="generation-selection-actions">
            {canSplitSelectedChapter && <button className="chapter-split-button" type="button" aria-label={t("Split {{title}} into shorter chapters", { title: selectedLongChapter?.title || t("long chapter") })} onClick={() => setSplitChapterId(selectedLongChapter?.id)}><span aria-hidden="true">💣</span></button>}
            {selectedChapters.length > 0 && currentGenerated.length > 0 && <button className="ghost" type="button" onClick={() => setStage(stageIndex("export"))}>{t("Continue to Export")}</button>}
            <button className="primary" disabled={busy || (!selectedChapters.length && !currentGenerated.length)} onClick={() => selectedChapters.length ? void generateChapters(selectedChapters) : setStage(stageIndex("export"))}>{busy ? t("Generating…") : selectedChapters.length ? `${t("Generate {{count}} selected", { count: selectedChapters.length })} →` : currentGenerated.length ? `${t("Continue to Export")} →` : t("Select chapters above")}</button>
          </div>
        </section>}
      </section>

      {splitChapter && <div className="chapter-player-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSplitChapterId(undefined); }}>
        <section className="chapter-split-modal" role="dialog" aria-modal="true" aria-labelledby="chapter-split-title">
          <button type="button" className="chapter-player-close" aria-label={t("Close chapter split")} disabled={busy} onClick={() => setSplitChapterId(undefined)}>×</button>
          <div className="chapter-split-heading"><span aria-hidden="true">💣</span><div><span className="eyebrow">{t("Long chapter")}</span><h2 id="chapter-split-title">{t("Split this into shorter chapters?")}</h2></div></div>
          <p>{t("{{title}} has {{duration}} of audio. It will become approximately {{count}} ordinary chapters around 30 minutes each.", { title: splitChapter.title, duration: chapterDuration(splitSeconds), count: proposedPartCount })}</p>
          <div className="chapter-split-facts"><span><b>{t("≈ {{count}} chapters", { count: proposedPartCount })}</b><small>{t("Usually 25–35 min each")}</small></span><span><b>{t("Safe text breaks")}</b><small>{t("Never inside a speech section")}</small></span></div>
          <p className="chapter-split-note">{t("The original item will be replaced. Review, cast and voices stay unchanged.")}</p>
          <div className="chapter-split-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setSplitChapterId(undefined)}>{t("Cancel")}</button><button className="primary" type="button" disabled={busy} onClick={() => void splitLongChapter(splitChapter.id)}>{busy ? t("Splitting…") : t("Split into ≈ {{count}} chapters", { count: proposedPartCount })}</button></div>
        </section>
      </div>}

      {listeningChapter && listeningAudio && <div className="chapter-player-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setListeningChapterId(undefined); }}>
        <section className="chapter-player-modal" role="dialog" aria-modal="true" aria-labelledby="chapter-player-title">
          <button type="button" className="chapter-player-close" aria-label={t("Close player")} onClick={() => setListeningChapterId(undefined)}>×</button>
          <div className="chapter-player-book" aria-hidden="true"><span>{t("Chapter")}</span><b>{String(chapters.findIndex((chapter) => chapter.id === listeningChapter.id) + 1).padStart(2, "0")}</b><i>♪</i></div>
          <div className="chapter-player-copy"><span className="eyebrow">{t(listeningAudio.current ? "Chapter audio" : "Older recording")}</span><h2 id="chapter-player-title">{listeningChapter.title || t("Untitled chapter")}</h2></div>
          <audio controls preload="metadata" src={listeningAudio.audioUrl} />
        </section>
      </div>}
    </>;
  }

  function ExportStage() {
    const generatedByChapter = new Map((snapshot?.generatedChapters ?? []).filter((row) => row.current).map((row) => [row.chapterId, row]));
    const playableChapters = (snapshot?.chapters ?? []).filter((row) => generatedByChapter.has(row.id));
    const selectedPlayable = playableChapters.filter((row) => exportChapterIds.includes(row.id));
    const selectedSeconds = selectedPlayable.reduce((total, row) => total + (generatedByChapter.get(row.id)?.audioSeconds ?? 0), 0);
    const pdfCoverUrl = book ? `/api/books/${book.id}/pages/${exportCoverPage}/image` : undefined;
    const coverUrl = exportCoverPreviewUrl ?? pdfCoverUrl;
    const pageCount = book?.pageCount ?? 1;
    return <>
      <section className="export-hero">
        <div className="export-hero-art" aria-hidden="true"><span className="export-vinyl">♪</span>{coverUrl && <img src={coverUrl} alt="" />}</div>
        <div><StepEyebrow stage="export">{t("Step 7 · Export")}</StepEyebrow><h1>{t("Package your audiobook.")}</h1><p>{t("Choose the finished chapter audio, confirm the book details, and create one shareable M4B.")}</p></div>
      </section>

      {!playableChapters.length ? <section className="export-empty"><span aria-hidden="true">♪</span><h2>{t("Generate a chapter first.")}</h2><p>{t("Export includes only the latest playable chapter audio. Nothing is ready yet.")}</p><button className="primary" onClick={() => setStage(stageIndex("generate"))}>← {t("Back to Generate")}</button></section> : <>
        <section className="export-layout">
          <div className="export-chapter-picker">
            <header><div><span className="eyebrow">{t("Choose audio")}</span><h2>{t("Chapters to include")}</h2></div><div className="chapter-bulk-actions"><button type="button" onClick={() => setExportChapterIds(playableChapters.map((row) => row.id))}>{t("Select all")}</button><button type="button" onClick={() => setExportChapterIds([])}>{t("Clear")}</button></div></header>
            <div className="export-chapter-list">{playableChapters.map((row) => {
              const index = (snapshot?.chapters ?? []).findIndex((chapter) => chapter.id === row.id);
              const audio = generatedByChapter.get(row.id)!;
              const selected = exportChapterIds.includes(row.id);
              const chapterNumber = String(index + 1).padStart(2, "0");
              const duration = chapterDuration(audio.audioSeconds, false);
              return <label key={row.id} className={selected ? "selected" : ""}>
                <input aria-label={t("Chapter {{number}}, {{duration}}", { number: chapterNumber, duration })} type="checkbox" checked={selected} onChange={(event) => setExportChapterIds(event.target.checked ? [...new Set([...exportChapterIds, row.id])] : exportChapterIds.filter((id) => id !== row.id))} />
                <span className="export-chapter-book" aria-hidden="true"><small>{t("Chapter")}</small><b>{chapterNumber}</b></span>
                <span className="export-chapter-duration">{duration}</span>
                <i aria-hidden="true">{selected ? "✓" : "+"}</i>
              </label>;
            })}</div>
          </div>

          <div className="export-metadata">
            <header><span className="eyebrow">{t("Book details")}</span><h2>{t("How it appears in your library")}</h2></header>
            <div className="export-cover-preview">
              {coverUrl && <img src={coverUrl} alt={t("Current audiobook cover")} />}
              <span><b>{t("Cover")}</b><small>{exportCover?.name ?? t("Page {{page}}", { page: exportCoverPage })}</small></span>
              <div className="export-cover-actions">
                {!exportCover && <label className="export-cover-page">{t("PDF page")}<input aria-label={t("PDF cover page")} type="number" min={1} max={pageCount} value={exportCoverPage} onChange={(event) => setExportCoverPage(Math.min(pageCount, Math.max(1, Number(event.target.value) || 1)))} /></label>}
                <label className="export-cover-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setExportCover(event.target.files?.[0])} /><span>{t(exportCover ? "Change image" : "Choose image")}</span></label>
                {exportCover && <button type="button" className="text-button" onClick={() => setExportCover(undefined)}>{t("Use PDF page")}</button>}
              </div>
            </div>
            <label>{t("Title")}<input value={exportTitle} maxLength={500} onChange={(event) => setExportTitle(event.target.value)} /></label>
            <label>{t("Author")}<input value={exportAuthor} maxLength={500} onChange={(event) => setExportAuthor(event.target.value)} /></label>
            <button type="button" className="text-button export-reset" onClick={() => { setExportTitle(book?.title ?? ""); setExportAuthor(book?.author ?? ""); setExportCover(undefined); setExportCoverPage(1); }}>{t("Reset book details")}</button>
          </div>
        </section>

        <section className="export-summary" aria-label={t("Export summary")}>
          <div><span className="eyebrow">{t("Ready to create")}</span><h2>{selectedPlayable.length ? t("{{count}} chapters · {{duration}}", { count: selectedPlayable.length, duration: chapterDuration(selectedSeconds, false) }) : t("Choose at least one chapter")}</h2><p>{t("One chaptered M4B, in book order, with the title, author, and cover shown above.")}</p></div>
          <button className="primary" disabled={exporting || !selectedPlayable.length || !exportTitle.trim()} onClick={() => void exportCurrent()}>{exporting ? t("Saving M4B…") : `${t("Create M4B")} →`}</button>
        </section>
      </>}
    </>;
  }

  async function splitLongChapter(chapterId: string) {
    if (!book) return;
    setBusy(true);
    setError(undefined);
    try {
      const script = await gateway.splitRecordingScriptChapter(book.id, chapterId);
      const partIds = (script.chapters ?? [])
        .filter((chapter) => chapter.splitFrom === chapterId)
        .map((chapter) => chapter.id);
      setSplitChapterId(undefined);
      setChapterFilter("all");
      await hydrate(book.id);
      setSelectedChapters(partIds);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function generateChapters(chapterIds: string[]) {
    if (!book) return;
    const unavailable = new Set(snapshot?.recordingScript?.summary.emptyChapterIds ?? []);
    const availableChapters = (snapshot?.chapters ?? []).filter((chapter) => !unavailable.has(chapter.id));
    const estimates = new Map((snapshot?.recordingScript?.summary.chapters ?? []).map((chapter) => [chapter.chapterId, chapter.estimatedSeconds]));
    const selected = new Set(chapterIds);
    setGenerationRun({
      chapterIds,
      estimatedAudioSeconds: availableChapters
        .filter((chapter) => selected.has(chapter.id))
        .reduce((total, chapter) => total + (estimates.get(chapter.id) ?? (chapter.estimatedCharacters ?? 0) / 15), 0),
      historicalMultiplier: averageGenerationMultiplier(generationSamples),
      startedAtMs: Date.now(),
    });
    setBusy(true);
    setGenerationInProgress(true);
    setProgress(0);
    setError(undefined);
    try {
      const completedJob = await runJob(await gateway.processStage(book.id, "generate", { chapterIds, language }));
      const sample = generationSample(completedJob);
      if (sample) setGenerationSamples((current) => [sample, ...current].sort((left, right) => right.finishedAt - left.finishedAt).slice(0, 3));
      await hydrate(book.id);
    } catch (reason) {
      setError(message(reason));
      void hydrate(book.id).catch(() => undefined);
    } finally {
      setGenerationInProgress(false);
      setGenerationRun(undefined);
      setBusy(false);
    }
  }

  async function exportCurrent() {
    if (!book || !snapshot) return;
    const selected = new Set(exportChapterIds);
    const chapters = snapshot.generatedChapters.filter((row) => row.current && selected.has(row.chapterId)).map((row) => ({ chapterId: row.chapterId, revision: row.revision }));
    if (!chapters.length) return;
    setExporting(true);
    try {
      await gateway.exportM4b(book.id, chapters, { title: exportTitle.trim(), author: exportAuthor.trim(), cover: exportCover, coverPage: exportCoverPage });
      await loadLibrary();
      navigateProduct("library");
    } catch (reason) { setError(message(reason)); }
    finally { setExporting(false); }
  }

  function navigateProduct(next: ProductView) {
    const path = productPaths[next];
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setProductView(next);
    if (next === "library") void loadLibrary();
  }

  async function openLibraryItem(exportId: string) {
    try {
      await gateway.openLibraryExport(exportId);
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function revealLibraryItem(exportId: string) {
    try {
      await gateway.revealLibraryExport(exportId);
    } catch (reason) {
      setError(message(reason));
    }
  }

}

function StepEyebrow({ stage, children }: { stage: WizardStep; children: ReactNode }) {
  return <span className="step-eyebrow">{children}<PhaseHelp stage={stage} /></span>;
}

function PageTitle({ stage, step, title, copy }: { stage: WizardStep; step: string; title: string; copy?: string }) {
  return <div className="page-title"><StepEyebrow stage={stage}>{step}</StepEyebrow><h1>{title}</h1>{copy && <p>{copy}</p>}</div>;
}

function StageLaunch({ children }: { children: ReactNode }) {
  return <div className="stage-launch">{children}</div>;
}

function PageComparison({ imageUrl, imageAlt, imageZoom, imageControls, rightLabel, rightMeta, className = "", rightClassName = "", children }: {
  imageUrl?: string;
  imageAlt: string;
  imageZoom?: number;
  imageControls?: ReactNode;
  rightLabel: string;
  rightMeta?: ReactNode;
  className?: string;
  rightClassName?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return <div className={`compare extract-compare page-comparison ${className}`.trim()}>
    <div className="paper">
      {imageControls ? <div className="paper-heading"><span>{t("ORIGINAL PAGE")}</span>{imageControls}</div> : <span>{t("ORIGINAL PAGE")}</span>}
      {imageUrl && (imageZoom
        ? <div className="pdf-preview-frame"><img src={imageUrl} alt={imageAlt} style={{ width: `${imageZoom}%` }} /></div>
        : <img src={imageUrl} alt={imageAlt} />)}
    </div>
    <div className={`extracted ${rightClassName}`.trim()}><div className="page-comparison-heading"><span>{rightLabel}</span>{rightMeta}</div>{children}</div>
  </div>;
}

const reviewPdfZoomLevels = [60, 80, 100, 125, 150] as const;

function ReviewTranscriptFinalCheck({ preview, loading, page, pageCount, busy, onPageChange, onBack, onAccept }: {
  preview?: ReviewTranscriptPreview;
  loading: boolean;
  page: number;
  pageCount: number;
  busy: boolean;
  onPageChange: (page: number) => void;
  onBack: () => void;
  onAccept: () => void;
}) {
  const { t } = useTranslation();
  const [pdfZoomIndex, setPdfZoomIndex] = useState(2);
  const safePageCount = Math.max(1, pageCount);
  const pdfZoom = reviewPdfZoomLevels[pdfZoomIndex];
  const changePage = (next: number) => onPageChange(Math.min(safePageCount, Math.max(1, next)));
  return <>
    <PageTitle stage="review" step={t("Step 3 · Final check")} title={t("Read it once like a listener.")} copy={t("Browse every PDF page beside the exact audiobook transcript. This is a read-only sanity check; nothing changes until you continue.")} />
    <section className="panel review-transcript-panel">
      <div className="transcript-page-control">
        <button type="button" aria-label={t("Previous transcript page")} disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}>←</button>
        <label><span>{t("Browse the whole book")}</span><input aria-label={t("Transcript preview page")} type="range" min="1" max={safePageCount} value={page} onChange={(event) => changePage(Number(event.target.value))} /></label>
        <output aria-live="polite">{page} / {safePageCount}</output>
        <button type="button" aria-label={t("Next transcript page")} disabled={page >= safePageCount || loading} onClick={() => changePage(page + 1)}>→</button>
      </div>
      <PageComparison imageUrl={preview?.imageUrl} imageAlt={t("Original PDF page {{page}}", { page: preview?.page ?? page })} imageZoom={pdfZoom} imageControls={<div className="pdf-zoom-controls" role="group" aria-label={t("PDF preview zoom")}>
        <button type="button" aria-label={t("Zoom out PDF preview")} disabled={pdfZoomIndex === 0} onClick={() => setPdfZoomIndex((current) => Math.max(0, current - 1))}>−</button>
        <output aria-live="polite">{pdfZoom}%</output>
        <button type="button" aria-label={t("Zoom in PDF preview")} disabled={pdfZoomIndex === reviewPdfZoomLevels.length - 1} onClick={() => setPdfZoomIndex((current) => Math.min(reviewPdfZoomLevels.length - 1, current + 1))}>+</button>
      </div>} rightLabel={t("AUDIOBOOK TRANSCRIPT")} rightMeta={<small>{loading ? t("Loading page {{page}}…", { page }) : t("Read-only preview")}</small>} rightClassName="review-transcript-pane" className={`review-transcript-compare ${loading ? "loading" : ""}`}>
        {preview?.spans.length ? <article aria-label={t("Audiobook transcript page {{page}}", { page: preview.page })} onCopy={(event) => event.preventDefault()}>
          {preview.spans.map((span) => <p key={span.id} className={`transcript-span ${span.reader === "Narrator" ? "narration" : span.kind}`}><b>{span.reader === "Narrator" ? t("Narrator") : span.reader}{span.kind === "excluded" && span.warningKind ? <small> · {t(reviewWarningLabel(span.warningKind))}</small> : null}</b><span>{span.text}</span></p>)}
        </article> : loading ? <div className="transcript-loading">{t("Opening the transcript…")}</div> : <div className="transcript-empty"><span aria-hidden="true">☾</span><b>{t("No spoken text on this page")}</b><small>{t("The source page may be blank or everything on it was excluded.")}</small></div>}
      </PageComparison>
    </section>
    <div className="phase-action transcript-final-action"><button type="button" className="ghost" onClick={onBack}>← {t("Back to decisions")}</button><span>{t("This is the last check before Cast & voices.")}</span><button type="button" className="primary" disabled={!preview || preview.page !== page || loading || busy} onClick={onAccept}>{t("Accept review and continue")} →</button></div>
  </>;
}

function AcceptedSummary({ stage, step, title, receipt, onRevise, children }: { stage: Exclude<WizardStage, "import">; step: string; title: string; revision?: unknown; receipt?: string; onRevise: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const actions = <div className="accepted-summary-badges"><Tag tone="good">{t("Complete")}</Tag>{receipt && <span className="accepted-cost-receipt" title={t("Estimated API cost from provider-reported usage")}>{receipt}</span>}</div>;
  return <><PageTitle stage={stage} step={step} title={title} /><Panel actions={actions} title={t("Accepted settings")}><div className="accepted-summary">{children}</div><div className="summary-note">{t("Your accepted version stays active while you prepare changes. Nothing is replaced until you approve the new result.")}</div><div className="summary-actions"><span>{t("Accepted and ready for the next steps")}</span><button className="primary" onClick={onRevise}>{t("Change settings")} →</button></div></Panel></>;
}

function formatApiCost(value: number) {
  if (value === 0) return "$0.00";
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function dialogueCorrections(candidate: RawDialogueCandidate): DialogueCorrectionDecision[] {
  return (candidate.userCorrections ?? []).flatMap((raw) => {
    const spanId = String(raw.spanId ?? "").trim();
    const action = String(raw.action ?? "");
    if (!spanId || (action !== "speaker" && action !== "narrator")) return [];
    const speakerLabel = String(raw.speakerLabel ?? "").trim();
    if (action === "speaker" && !speakerLabel) return [];
    return [{ spanId, action, ...(action === "speaker" ? { speakerLabel } : {}), provenance: "user" as const }];
  });
}

function methodLabel(method: ExtractionMethod) {
  return method === "liteparse" ? "LiteParse" : method === "native" ? "Native" : "Layout-aware";
}

type DialogueConflictGroup = {
  groupId: string;
  profileIds: [string, string];
  conflicts: DialogueConflict[];
  winnerProfileId?: string;
};

function groupDialogueConflicts(conflicts: DialogueConflict[]): DialogueConflictGroup[] {
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

function DialogueStructuralReview({ issues, choices, onChoose, onApply }: { issues: DialogueStructuralIssue[]; choices: Record<string, DialogueStructuralAction>; onChoose: (issueId: string, action: DialogueStructuralAction) => void; onApply: () => void }) {
  const { t } = useTranslation();
  const ready = issues.every((issue) => Boolean(choices[issue.id]));
  return <Panel eyebrow={t("Quick review")} title={issues.length === 1 ? t("1 interrupted dialogue turn needs your choice") : t("{{count}} interrupted dialogue turns need your choice", { count: issues.length })} actions={<Tag tone="warn">{t("Before AI")}</Tag>}><p className="panel-copy">{t("A new labelled turn begins before the previous detection closes. Choose the resulting speaker turns; the extracted words never change.")}</p><div className="conflict-groups">{issues.map((issue, index) => {
    const selected = choices[issue.id];
    const split = issue.interpretations.split;
    const together = issue.interpretations["keep-together"];
    return <article className="conflict-group structural-issue" key={issue.id}><header><div className="conflict-group-heading"><small>{t("Interrupted turn {{number}}", { number: index + 1 })}</small><b>{t("Page {{page}}", { page: issue.page })}</b><span>{t("{{speaker}} contains a new {{inner}} turn", { speaker: issue.outerSpeakerLabel ?? t("Unknown speaker"), inner: issue.innerSpeakerLabels.join(", ") })}</span></div><div className="structural-choices" role="group" aria-label={t("Choose a result for interrupted turn {{number}}", { number: index + 1 })}><button className={selected === "split" ? "selected" : ""} onClick={() => onChoose(issue.id, "split")}><b>{t("Split into detected turns")}</b><small>{t("Each visible speaker reads their own line.")}</small></button><button className={selected === "keep-together" ? "selected" : ""} onClick={() => onChoose(issue.id, "keep-together")}><b>{t("Keep as one turn")}</b><small>{t("{{speaker}} reads the whole highlighted span.", { speaker: issue.outerSpeakerLabel ?? t("The first speaker") })}</small></button><button className={selected === "narration" ? "selected" : ""} onClick={() => onChoose(issue.id, "narration")}><b>{t("Leave as narration")}</b><small>{t("No speaker assignment is inferred here.")}</small></button></div></header><div className="conflict-example"><div className="conflict-source">{issue.contextBefore && <span>{issue.contextBefore}</span>}<mark>{issue.source}</mark>{issue.contextAfter && <span>{issue.contextAfter}</span>}</div><div className="conflict-result-label">{t("What this becomes")}</div><div className="structural-preview">{selected === "narration" ? <div className="selected"><b>{t("Narrator")}</b><span>{t("The highlighted source remains intact narration.")}</span></div> : (selected === "keep-together" ? together : split).map((claim) => <div key={claim.matchId} className={selected ? "selected" : ""}><b>{claim.speakerLabel ?? t("Speaker not identified")}</b><span>{claim.spokenText}</span></div>)}</div></div></article>;
  })}</div><div className="conflict-help">{t("Choices are recorded per interrupted turn. Nothing is repaired or rewritten silently.")}</div><div className="phase-action"><button className="primary" disabled={!ready} onClick={onApply}>{t("Apply choices and continue")} →</button></div></Panel>;
}

function ResolvedStructuralIssues({ issues }: { issues: DialogueStructuralIssue[] }) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  return <details className="resolved-conflicts"><summary><span><b>{t("Interrupted turns resolved")}</b><small>{t("{{count}} turns · source text preserved", { count: issues.length })}</small></span><Tag tone="good">{t("Resolved")}</Tag></summary><div className="resolved-conflicts-body">{issues.map((issue) => <div className="resolved-structural-row" key={issue.id}><b>{t("Page {{page}}", { page: issue.page })}</b><span>{issue.selectedAction === "split" ? t("Split into detected speaker turns") : issue.selectedAction === "keep-together" ? t("Kept as one {{speaker}} turn", { speaker: issue.outerSpeakerLabel ?? t("speaker") }) : t("Left as narration")}</span></div>)}</div></details>;
}

function DialogueConflictReview({ groups, regexes, choices, onChoose, onReviewRules, onApply }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void; onReviewRules: () => void; onApply: () => void }) {
  const { t } = useTranslation();
  const ready = groups.every((group) => Boolean(choices[group.groupId]));
  const total = groups.reduce((count, group) => count + group.conflicts.length, 0);
  return <Panel eyebrow={t("Quick review")} title={total === 1 ? t("1 overlapping dialogue match needs your choice") : t("{{count}} overlapping dialogue matches need your choice", { count: total })} actions={<Tag tone="warn">{t("Before AI")}</Tag>}><p className="panel-copy">{t("Two useful detection rules claimed the same source. Keep both rules enabled and choose which interpretation wins for each group of similar overlaps.")}</p><DialogueConflictGroups groups={groups} regexes={regexes} choices={choices} onChoose={onChoose} /><div className="conflict-help">{t("Your choice applies only where these two rules overlap. Their other matches stay untouched.")}</div><div className="phase-action"><button className="ghost" onClick={onReviewRules}>{t("Review detection rules")}</button><button className="primary" disabled={!ready} onClick={onApply}>{t("Apply choices and continue")} →</button></div></Panel>;
}

function DialogueRulesSection({ regexes, open, strategy, attributionTargets, onToggle, onToggleRegex, onAddRegex, onError }: { regexes: DialogueRegex[]; open: boolean; strategy: DialogueStrategy; attributionTargets: DialogueAttributionTarget[]; onToggle: () => void; onToggleRegex: (id: string, enabled: boolean) => void; onAddRegex: (regex: { label: string; pattern: string; flags: string }) => Promise<boolean>; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const [regex, setRegex] = useState({ label: "", pattern: "", flags: "m" });
  const [submitting, setSubmitting] = useState(false);
  const matchingRegexes = regexes.filter((row) => row.matchCount > 0);
  const enabledCount = matchingRegexes.filter((row) => row.enabled).length;
  const customCount = matchingRegexes.filter((row) => !row.builtIn).length;
  async function addRegex() {
    if (!regex.label.trim() || !regex.pattern.trim()) return onError("Name and regex are required.");
    setSubmitting(true);
    try {
      if (await onAddRegex(regex)) setRegex({ label: "", pattern: "", flags: "m" });
    } finally {
      setSubmitting(false);
    }
  }
  return <section className={`advanced-section dialogue-rules-section ${open ? "open" : ""}`}>
    <button type="button" className="advanced-summary dialogue-rules-summary" aria-label={t("Dialogue detection rules")} aria-expanded={open} onClick={onToggle}>
      <span><b>{t("Dialogue detection rules")}</b><small>{t("{{matching}} matching · {{enabled}} enabled · {{builtIn}} built in · {{custom}} custom", { matching: matchingRegexes.length, enabled: enabledCount, builtIn: matchingRegexes.length - customCount, custom: customCount })}</small></span>
      <span>{t(open ? "Collapse" : "Review rules and examples")}</span>
    </button>
    {open && <div className="dialogue-rules-body">
      {matchingRegexes.length ? <div className="regex-results">{matchingRegexes.map((row) => <article className={row.enabled ? "" : "disabled"} key={row.id}>
        <label className="regex-toggle"><input type="checkbox" checked={row.enabled} onChange={(event) => onToggleRegex(row.id, event.target.checked)} /><span><strong>{t(row.label, { defaultValue: row.label })}</strong><small>{t("{{count}} matches · {{kind}}", { count: row.matchCount, kind: t(row.builtIn ? "built in" : "custom") })}</small>{row.label === "Unlabelled straight quotation" && <span className="regex-description">{t("Catches likely dialogue without speaker labels, including")} <q>{t("Alice says, “I’m late!”")}</q> {t("Review verifies uncertain matches before speech is generated.")}</span>}</span></label>
        <div className="regex-examples">{row.examples.slice(0, 3).map((example) => <div key={example.spanId}><small>{t("Page {{page}} · {{speaker}}", { page: example.page, speaker: example.speakerLabel ?? t("speaker not captured") })}</small><div className="regex-source-window">{example.contextBefore && <span>{example.contextBefore}</span>}<mark>{example.source}</mark>{example.contextAfter && <span>{example.contextAfter}</span>}</div>{example.speakerStatus === "unlabelled" ? strategy === "fill-gaps" && attributionTargets.includes("unlabelled-candidates") ? <b className="pending-ai">{t("Pending AI check")}</b> : <b>{t("Narrator will read: {{text}}", { text: example.spokenText })}</b> : <b>{t("Will speak: {{text}}", { text: example.spokenText })}</b>}</div>)}</div>
      </article>)}</div> : <div className="empty-dialogue"><b>{t("No likely dialogue was detected.")}</b><span>{t("The narrator will read the source unless you add a matching regex.")}</span></div>}
      <details className="dialogue-custom-builder"><summary><span><b>{t("Add a custom detection rule")}</b><small>{t("For a recurring source-specific format")}</small></span><span>{t("Advanced")}</span></summary><div><p className="panel-copy">{t("Use Python-style named captures:")} <code>(?P&lt;text&gt;...)</code> {t("and optionally")} <code>(?P&lt;speaker&gt;...)</code>.</p><div className="raw-regex-form"><label>{t("Name")}<input value={regex.label} onChange={(event) => setRegex({ ...regex, label: event.target.value })} /></label><label>{t("Regex")}<input value={regex.pattern} onChange={(event) => setRegex({ ...regex, pattern: event.target.value })} /></label><label>{t("Flags")}<input value={regex.flags} onChange={(event) => setRegex({ ...regex, flags: event.target.value })} /></label><button className="ghost" disabled={submitting} onClick={() => void addRegex()}>{t("Add and preview")}</button></div></div></details>
    </div>}
  </section>;
}

function UnknownSpeakerLabelsSection({ patterns, onRemove, onAdd }: { patterns: string[]; onRemove: (pattern: string) => void; onAdd: (pattern: string) => void }) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState("");
  return <section className="unknown-speaker-labels" aria-labelledby="unknown-speaker-labels-title"><div><b id="unknown-speaker-labels-title">{t("Labels that mean “speaker unknown”")}</b><small>{t("These source labels stay visible, but may be offered to AI for speaker identification.")}</small></div><div className="token-editor">{patterns.map((row) => <span key={row}><code>{row}</code><button aria-label={t("Remove {{label}}", { label: row })} onClick={() => onRemove(row)}>×</button></span>)}<input aria-label={t("Add unknown speaker pattern")} placeholder={t("Add another label pattern")} value={pattern} onChange={(event) => setPattern(event.target.value)} /><button className="ghost" onClick={() => { const next = pattern.trim(); if (!next) return; onAdd(next); setPattern(""); }}>{t("Add label")}</button></div></section>;
}

function ResolvedDialogueConflicts({ groups, regexes, choices, onChoose, onApply }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void; onApply: () => void }) {
  const { t } = useTranslation();
  if (!groups.length) return null;
  const total = groups.reduce((count, group) => count + group.conflicts.length, 0);
  return <details className="resolved-conflicts"><summary><span><b>{t("Regex overlaps resolved")}</b><small>{t("{{count}} matches · review or change before regenerating", { count: total })}</small></span><Tag tone="good">{t("Resolved")}</Tag></summary><div className="resolved-conflicts-body"><DialogueConflictGroups groups={groups} regexes={regexes} choices={choices} onChoose={onChoose} /><div className="phase-action"><button className="primary" disabled={!Object.keys(choices).length} onClick={onApply}>{t("Update choices")} →</button></div></div></details>;
}

function DialogueConflictGroups({ groups, regexes, choices, onChoose }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void }) {
  const { t } = useTranslation();
  const labels = new Map(regexes.map((regex) => [regex.id, regex.label]));
  return <div className="conflict-groups">{groups.map((group) => {
    const selected = choices[group.groupId] ?? group.winnerProfileId;
    const overlapLabel = group.conflicts.length === 1 ? t("1 overlap") : t("{{count}} overlaps", { count: group.conflicts.length });
    const shownExamples = Math.min(group.conflicts.length, 4);
    return <article className="conflict-group" key={group.groupId}>
      <header>
        <div className="conflict-group-heading"><small>{t("This choice applies to")}</small><b>{t("{{overlaps}} total", { overlaps: overlapLabel })}</b><span>{group.conflicts.length <= 4 ? t("Showing all {{count}} examples", { count: shownExamples }) : t("Showing {{count}} representative examples", { count: shownExamples })}</span></div>
        <div className="conflict-choices" role="group" aria-label={t("Choose a result for {{count}} overlapping matches", { count: group.conflicts.length })}>
          {group.profileIds.map((profileId) => {
            const label = labels.get(profileId) ?? profileId;
            const isSelected = selected === profileId;
            return <button key={profileId} type="button" className={isSelected ? "selected" : ""} aria-label={t("Choose {{label}} for all {{overlaps}}", { label, overlaps: overlapLabel })} aria-pressed={isSelected} onClick={() => onChoose(group.groupId, profileId)}><span className="conflict-choice-radio" aria-hidden="true">{isSelected ? "✓" : ""}</span><span><b>{label}</b><small>{t(isSelected ? "Selected for all {{overlaps}}" : "Choose for all {{overlaps}}", { overlaps: overlapLabel })}</small></span></button>;
          })}
          <button type="button" className={selected === "narration" ? "selected" : ""} aria-label={t("Choose narration for all {{overlaps}}", { overlaps: overlapLabel })} aria-pressed={selected === "narration"} onClick={() => onChoose(group.groupId, "narration")}><span className="conflict-choice-radio" aria-hidden="true">{selected === "narration" ? "✓" : ""}</span><span><b>{t("Neither — leave as narration")}</b><small>{t(selected === "narration" ? "Selected for all {{overlaps}}" : "Choose for all {{overlaps}}", { overlaps: overlapLabel })}</small></span></button>
        </div>
      </header>
      <div className="conflict-examples">{group.conflicts.slice(0, 4).map((conflict, index) => <section key={conflict.id} className="conflict-example" aria-label={t("Overlap example {{number}}", { number: index + 1 })}>
        <div className="conflict-example-heading"><b>{t("Example {{number}} of {{count}} shown", { number: index + 1, count: shownExamples })}</b><small>{t("Page {{page}}", { page: conflict.page })}</small></div>
        <div className="conflict-source">{conflict.claims[0].contextBefore && <span>{conflict.claims[0].contextBefore}</span>}<mark>{conflict.claims[0].source}</mark>{conflict.claims[0].contextAfter && <span>{conflict.claims[0].contextAfter}</span>}</div>
        <div className="conflict-result-label">{t("What this becomes")}</div>
        <div className="conflict-interpretations">{group.profileIds.map((profileId) => conflict.claims.find((claim) => claim.profileId === profileId)).filter((claim): claim is DialogueConflict["claims"][number] => Boolean(claim)).map((claim) => {
          const isSelected = selected === claim.profileId;
          return <div key={claim.matchId} className={isSelected ? "selected" : ""}><header><b>{labels.get(claim.profileId) ?? claim.profileId}</b>{isSelected && <small>{t("Selected")}</small>}</header><dl><div><dt>{t("Detected speaker")}</dt><dd className={claim.speakerLabel ? "" : "muted"}>{claim.speakerLabel ?? t("Not identified")}</dd></div><div><dt>{t("Detected dialogue")}</dt><dd className="conflict-spoken-text">{claim.spokenText}</dd></div></dl></div>;
        })}{selected === "narration" && <div className="selected"><header><b>{t("Narrator")}</b><small>{t("Selected")}</small></header><dl><div><dt>{t("Result")}</dt><dd className="conflict-spoken-text">{t("Neither regex interpretation becomes a dialogue turn.")}</dd></div></dl></div>}</div>
      </section>)}</div>
      {group.conflicts.length > 4 && <small className="more-conflicts">{t("Showing 4 representative examples. This choice will apply to all {{count}} overlaps.", { count: group.conflicts.length })}</small>}
    </article>;
  })}</div>;
}
