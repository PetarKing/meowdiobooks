import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { wizardApi as defaultWorkflowGateway, normalizeDialogueArtifact } from "../api/client";
import type {
  AcceptanceDecision,
  AudioExportPreset,
  CastArtifact,
  DialogueArtifact,
  DialogueAttributionRoute,
  DialogueAttributionTarget,
  DialogueStrategy,
  DialogueStructuralAction,
  ExtractionMethod,
  ExtractionPreview,
  Job,
  LibraryExport,
  LocalBook,
  ProcessableStage,
  RawDialogueCandidate,
  RepresentativePage,
  ReviewCandidate,
  ReviewCapability,
  ReviewTranscriptPreview,
  StageCandidate,
  StageSettings,
  VoiceRoute,
  WizardSnapshot,
  WizardStage
} from "../api/contracts";
import { type IdentityDecision } from "../castIdentity";
import { type DialogueCorrectionDecision } from "../components/DialogueResultReview";
import { confirmedVoiceRoutesForCast, voiceRoutesForCast } from "../voiceRoutes";
import {
  acceptedVoiceSelections,
  automaticSharedVoiceSelections,
  decisionsForCast,
  defaultNarratorDirection,
  resolvedLabelsForCast
} from "../workflow/cast";
import {
  availableAttributionTargets,
  dialogueSettings
} from "../workflow/dialogue";
import {
  averageGenerationMultiplier,
  generationSample,
  publicGenerationEstimatePolicy,
  readyChapterCount,
  recentGenerationSamples,
  remainingGenerationTime,
  type GenerationRun,
  type GenerationSample
} from "../workflow/generation";
import {
  isRetryableJobPollError,
  jobPollIntervalMs,
  maximumJobPollBackoffMs,
  pollJobWithForegroundRefresh,
  reconnectingJobMessage,
  waitForNextJobPoll,
} from "../workflow/jobPolling";
import {
  persistedSidebarCollapsed,
  productPaths,
  productViewFromPath,
  publicJourney,
  sidebarPreferenceKey,
  type JourneyStepId,
  type ProductView,
  type WizardStep
} from "../workflow/navigation";
import {
  decodeImage,
  message
} from "../workflow/presentation";
import type { AppProps, WorkflowCapabilities } from "./contracts";
import { dialogueCorrections } from "./dialogueCorrections";

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

const publicWorkflowCapabilities: WorkflowCapabilities = {
  localDialogueAttribution: true,
  showExecutionBadge: true,
  showProviderCostReceipts: true,
};


// Own workflow state and commands in one place; pages receive typed subsets.
// Presentation values never select commands or alter accepted workflow state.
export function useWorkflowModel({
  gateway = defaultWorkflowGateway,
  journey = publicJourney,
  stepOverrides = {},
  renderHeader,
  renderLibraryActions,
  capabilities: capabilityOverrides = {},
  generationEstimatePolicy: generationEstimateOverrides = {},
}: AppProps) {
  const capabilities = { ...publicWorkflowCapabilities, ...capabilityOverrides };

  const generationEstimatePolicy = {
    ...publicGenerationEstimatePolicy,
    ...generationEstimateOverrides,
  };

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

  const [cancelRequestPending, setCancelRequestPending] = useState(false);

  const [extractionTransition, setExtractionTransition] = useState(false);

  const [reviewTransition, setReviewTransition] = useState(false);

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

  const [castingSources, setCastingSources] = useState<{ bookId: string; ids: string[]; }>({ bookId: "", ids: [] });

  const [castingPreviewReady, setCastingPreviewReady] = useState(false);

  const [castingPreviewFingerprint, setCastingPreviewFingerprint] = useState<string>();

  const updateCastingPreview = useCallback((ready: boolean, fingerprint?: string) => { setCastingPreviewReady(ready); setCastingPreviewFingerprint(fingerprint); }, []);

  const [voiceModel, setVoiceModel] = useState("");

  const [language, setLanguage] = useState("");

  const [designingVoices, setDesigningVoices] = useState(false);

  const [narrationLanguageConfirmed, setNarrationLanguageConfirmed] = useState(false);

  const [narratorDirection, setNarratorDirection] = useState(defaultNarratorDirection);

  const [editingCast, setEditingCast] = useState(false);

  const [castGenerationPaused, setCastGenerationPaused] = useState(false);

  const [regeneratingCharacterId, setRegeneratingCharacterId] = useState<string>();

  const [uploadingCharacterId, setUploadingCharacterId] = useState<string>();

  const [deletingVoiceRevision, setDeletingVoiceRevision] = useState<string>();

  const [confirmDefaultVoices, setConfirmDefaultVoices] = useState(false);

  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);

  const [chapterFilter, setChapterFilter] = useState<"all" | "pending" | "generated">("all");

  const [listeningChapterId, setListeningChapterId] = useState<string>();

  const [splitChapterId, setSplitChapterId] = useState<string>();

  const [exportChapterIds, setExportChapterIds] = useState<string[]>([]);

  const [exportTitle, setExportTitle] = useState("");

  const [exportAuthor, setExportAuthor] = useState("");

  const [exportCover, setExportCover] = useState<File>();

  const [exportCoverPage, setExportCoverPage] = useState(1);

  const [exportPreset, setExportPreset] = useState<AudioExportPreset>("m4b-high");

  const [exportCoverPreviewUrl, setExportCoverPreviewUrl] = useState<string>();

  const [exporting, setExporting] = useState(false);

  const [revisingStages, setRevisingStages] = useState<string[]>([]);

  const libraryRequest = useRef<Promise<void> | undefined>(undefined);

  const reviewStripRef = useRef<HTMLDivElement | null>(null);
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

  const recoveryStageIndex = stageIndex("review");

  const routeStage = (requestedStage: number, current = snapshot) => (
    current?.dialogueRecovery && requestedStage >= recoveryStageIndex
      ? recoveryStageIndex
      : requestedStage
  );

  const generateComplete = Boolean(snapshot?.generatedChapters.some((row) => row.current));

  const unlockedThrough = generateComplete
    ? stageIndex("export")
    : snapshot ? Math.min(stageIndex("generate"), Math.max(0, nextStage(completed))) : 0;

  const hasDraft = (stageId?: WizardStep) => {
    if (stageId === "dialogue") return Boolean(dialogueCandidate) && !editingAcceptedDialogue;
    if (stageId === "review") return Boolean(reviewCandidate);
    if (stageId === "cast") return Boolean(castCandidate && castCandidate.revision !== snapshot?.cast?.revision);
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
    void runJob({ id, status: "running" }, async (job) => {
      const bookId = typeof job.result?.bookId === "string"
        ? job.result.bookId
        : typeof job.payload?.book_id === "string" ? job.payload.book_id : undefined;
      if (bookId) await restoreBookView(bookId);
    })
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
    if (!listeningChapterId) return;
    const closePlayer = (event: KeyboardEvent) => {
      if (event.key === "Escape") setListeningChapterId(undefined);
    };
    window.addEventListener("keydown", closePlayer);
    return () => window.removeEventListener("keydown", closePlayer);
  }, [listeningChapterId]);

  async function hydrate(bookId: string) {
    let next = await gateway.getBookSnapshot(bookId);
    if (
      next.book.completedStages.includes("cast")
      && !next.recordingScript
      && !next.dialogueRecovery
    ) {
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
    setVoiceSelections({
      ...automaticSharedVoiceSelections(restoredCast),
      ...acceptedVoiceSelections(restoredCast),
    });
    setVoiceRoutes(voiceRoutesForCast(restoredCast));
    setConfirmedVoiceRoutes(confirmedVoiceRoutesForCast(restoredCast));
    if (restoredCast) {
      setIdentityDecisions(decisionsForCast(restoredCast));
      setResolvedLabels(resolvedLabelsForCast(restoredCast));
    }
    setNarratorDirection(restoredCast?.narrator?.voiceDirection ?? defaultNarratorDirection);
    const recoverableCast = next.recoverableStages?.cast;
    const resumeMatchesProposal = Boolean(
      recoverableCast && recoverableCast.proposalRevision === restoredCast?.revision
    );
    setCastGenerationPaused(resumeMatchesProposal);
    setDesigningVoices(resumeMatchesProposal);
    setNarrationLanguageConfirmed(Boolean((resumeMatchesProposal && recoverableCast?.language) || (restoredCast?.phase !== "identity-review" && restoredCast?.language)));
    setListeningChapterId(undefined);
    const model = (
      resumeMatchesProposal ? recoverableCast?.modelId : undefined
    ) ?? restoredCast?.voiceModel ?? next.voiceSelection.modelId ?? next.voiceModels[0]?.id;
    setVoiceModel(model ?? "");
    const supported = next.voiceModels.find((row) => row.id === model)?.supportedLanguages ?? [];
    const detected = restoredCast?.detectedLanguage;
    setLanguage((resumeMatchesProposal ? recoverableCast?.language : undefined) ?? restoredCast?.language ?? next.voiceSelection.language ?? (detected && supported.includes(detected) ? detected : supported.includes("english") ? "english" : supported[0] ?? ""));
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

  async function runJob(initial: Job, onSettled?: (job: Job) => Promise<void>): Promise<Job> {
    let current = initial;
    let consecutivePollFailures = 0;
    setActiveJob(current);
    localStorage.setItem("meowdiobooks.activeJob", current.id);
    while (["queued", "running"].includes(current.status)) {
      setProgress(current.progress ?? 0);
      setProcessMessage(current.message ?? "");
      try {
        current = await pollJobWithForegroundRefresh(gateway, current.id);
        consecutivePollFailures = 0;
      } catch (reason) {
        if (!isRetryableJobPollError(reason)) {
          localStorage.removeItem("meowdiobooks.activeJob");
          setActiveJob(undefined);
          throw reason;
        }
        consecutivePollFailures += 1;
        setProcessMessage(reconnectingJobMessage);
        await waitForNextJobPoll(Math.min(
          jobPollIntervalMs * 2 ** (consecutivePollFailures - 1),
          maximumJobPollBackoffMs,
        ));
        continue;
      }
      setActiveJob(current);
      setProgress(current.progress ?? 0);
      setProcessMessage(current.message ?? "");
      if (["queued", "running"].includes(current.status)) {
        await waitForNextJobPoll(jobPollIntervalMs);
      }
    }
    localStorage.removeItem("meowdiobooks.activeJob");
    setActiveJob(undefined);
    // Reattachment must restore saved book context even when the worker failed.
    if (onSettled) await onSettled(current);
    if (current.status !== "succeeded") throw new Error(current.error ?? `Job ${current.status}`);
    setProgress(100);
    return current;
  }

  async function cancelActiveStageJob() {
    if (!activeJob || cancelRequestPending || activeJob.cancel_requested_at) return;
    setCancelRequestPending(true);
    setError(undefined);
    try {
      const current = await wizardApi.cancelJob(activeJob.id);
      setActiveJob(current);
      setProcessMessage(current.message ?? "Cancellation requested; stopping safely");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setCancelRequestPending(false);
    }
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
      const candidate = await gateway.getStageCandidate(book.id, stageId, revision);
      if (stageId === "cast") setCastGenerationPaused(false);
      return candidate;
    } catch (reason) {
      if (stageId === "cast") setCastGenerationPaused(true);
      throw reason;
    } finally {
      setBusy(false);
      setProcessingOverlaySuppressed(false);
    }
  }

  async function acceptCandidate(stageId: ProcessableStage, candidate: { revision?: unknown; conflicts?: unknown[]; } | undefined, decisions: AcceptanceDecision[] = []) {
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
      setStage(routeStage(
        Math.min(stageIndex("generate"), nextStage(next.book.completedStages)),
        next,
      ));
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
      setStage(routeStage(
        Math.min(stageIndex("generate"), nextStage(next.book.completedStages)),
        next,
      ));
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
      setStage(routeStage(nextStage(next.book.completedStages), next));
      setHome(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function restoreBookView(bookId: string) {
    const next = await hydrate(bookId);
    const pages = await gateway.getRepresentativePages(bookId);
    setRepresentatives(pages);
    setExtractionPreview(await gateway.previewExtraction(bookId, pages[0]?.page ?? 1, method));
    setStage(routeStage(nextStage(next.book.completedStages), next));
    navigateProduct("create");
    setHome(false);
  }

  async function openBook(local: LocalBook) {
    setOpeningBookId(local.id);
    setBusy(true);
    setError(undefined);
    try {
      await restoreBookView(local.id);
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

  async function rebuildDialogueFromRecovery() {
    if (!book || !snapshot?.dialogueRecovery || busy) return;
    const accepted = snapshot.dialogue ?? dialogue;
    const strategy = accepted.strategy ?? "fill-gaps";
    const targets = accepted.attributionTargets ?? ["unlabelled-candidates"];
    setBusy(true);
    setError(undefined);
    try {
      const preview = await gateway.previewDialogue(
        book.id,
        dialogueSettings(accepted, strategy, targets),
      );
      setDialogue(preview);
      setDialogueStrategy(strategy);
      setAttributionTargets(targets);
      setDialogueInitialDecisions([]);
      setDialogueCandidate(undefined);
      setEditingAcceptedDialogue(false);
      setConflictChoices({});
      setStructuralChoices({});
      setRevisingStages((current) => [...new Set([...current, "dialogue"])]);
      setStage(stageIndex("dialogue"));
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

  const recoveringDownstreamDialogue = Boolean(
    snapshot?.dialogueRecovery
    && activeJourneyStep
    && stage >= recoveryStageIndex,
  );

  const showWizard = productView === "create" && !home;

  const dialogueProcessing = dialogueLaunchPending || activeJob?.kind === "v2:dialogue";

  const generationReady = readyChapterCount(generationRun, activeJob, progress);

  const generationRemaining = remainingGenerationTime(
    generationRun,
    activeJob,
    progress,
    generationEstimatePolicy,
  );

  const runningStageCanBeCanceled = activeJob?.kind === "v2:cast" || activeJob?.kind === "v2:generate";

  const showCancelActiveJob = Boolean(
    activeJob
    && ["queued", "running"].includes(activeJob.status)
    && (activeJob.status === "queued" || runningStageCanBeCanceled),
  );

  const cancelActiveJobLabel = cancelRequestPending || activeJob?.cancel_requested_at
    ? t("Canceling…")
    : activeJob?.kind === "v2:cast"
      ? t("Cancel voice generation")
      : activeJob?.kind === "v2:generate"
        ? t("Cancel audio generation")
        : t("Cancel queued job");

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
      const options = { title: exportTitle.trim(), author: exportAuthor.trim(), cover: exportCover, coverPage: exportCoverPage, preset: exportPreset };
      if (gateway.createAudioExport) await gateway.createAudioExport(book.id, chapters, options);
      else if (exportPreset === "m4b-high" && gateway.createM4bExport) await gateway.createM4bExport(book.id, chapters, options);
      else if (exportPreset === "m4b-high") await gateway.exportM4b(book.id, chapters, options);
      else throw new Error("This export format is not supported by the current edition.");
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
  return { castingPreviewFingerprint, acceptCandidate, activeBoundary, activeJob, activeJourneyStep, activeOccurrence, activeReviewGroup, activeWarning, attributionTargets, book, bookPendingDeletion, books, boundaryDecisions, busy, cancelActiveJobLabel, cancelActiveStageJob, cancelRequestPending, capabilities, castCandidate, castGenerationPaused, castingPreviewReady, castingSources, chapterFilter, completed, confirmDefaultVoices, confirmedVoiceRoutes, conflictChoices, deleteBook, deletingBookId, deletingVoiceRevision, designingVoices, dialogue, dialogueCandidate, dialogueInitialDecisions, dialogueLaunchPending, dialogueProcessing, dialogueProcessingRoute, dialogueRouteChoiceOpen, dialogueRulesOpen, dialogueStrategy, editingAcceptedDialogue, editingCast, error, exportAuthor, exportChapterIds, exportCover, exportCoverPage, exportCoverPreviewUrl, exportCurrent, exportPreset, exportTitle, exporting, extractionPreview, extractionTransition, file, gateway, generateChapters, generateComplete, generationEstimatePolicy, generationInProgress, generationReady, generationRemaining, generationRun, generationSamples, hasDraft, home, hydrate, identityDecisions, importBook, language, libraryExports, libraryReady, listeningChapterId, method, narrationLanguageConfirmed, narratorDirection, navigateProduct, openBook, openLibraryItem, openingBookId, previewPage, processAndPublishExtraction, processCandidate, processMessage, processingOverlaySuppressed, productView, progress, rebuildDialogueFromRecovery, recoveringDownstreamDialogue, refreshDialogue, regeneratingCharacterId, renderHeader, renderLibraryActions, reopenAcceptedDialogueReview, representatives, requestDialogueTranscript, resolvedLabels, revealLibraryItem, reviewCandidate, reviewDecisions, reviewFinalCheck, reviewPreviewLoading, reviewPreviewPage, reviewStripRef, reviewTranscriptPreview, reviewTransition, revisingStages, routeStage, runDialogueTranscript, selectedChapters, setActiveBoundary, setActiveOccurrence, setActiveReviewGroup, setActiveWarning, setAttributionTargets, setBookPendingDeletion, setBoundaryDecisions, setCastCandidate, setCastGenerationPaused, setCastingSources, setChapterFilter, setConfirmDefaultVoices, setConfirmedVoiceRoutes, setConflictChoices, setDeletingVoiceRevision, setDesigningVoices, setDialogue, setDialogueCandidate, setDialogueInitialDecisions, setDialogueRouteChoiceOpen, setDialogueRulesOpen, setDialogueStrategy, setEditingAcceptedDialogue, setEditingCast, setError, setExportAuthor, setExportChapterIds, setExportCover, setExportCoverPage, setExportPreset, setExportTitle, setFile, setHome, setIdentityDecisions, setLanguage, setListeningChapterId, setMethod, setNarrationLanguageConfirmed, setNarratorDirection, setProcessMessage, setProgress, setRegeneratingCharacterId, setResolvedLabels, setReviewCandidate, setReviewDecisions, setReviewFinalCheck, setReviewPreviewPage, setReviewTransition, setRevisingStages, setSelectedChapters, setSplitChapterId, setStage, setStructuralChoices, setUploadingCharacterId, setVoiceModel, setVoiceRoutes, setVoiceSelections, showCancelActiveJob, showWizard, sidebarCollapsed, snapshot, splitChapterId, splitLongChapter, stage, stageIndex, stages, stepOverrides, structuralChoices, t, toggleSidebar, uiLocale, unlockedThrough, updateCastingPreview, uploadingCharacterId, voiceModel, voiceRoutes, voiceSelections };
}

export type WorkflowModel = ReturnType<typeof useWorkflowModel>;
