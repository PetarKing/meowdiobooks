import { buildReviewPreviewPolicies } from "../reviewDecisions";
import { normalizeCandidateWarnings } from "../workflow/review";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { wizardApi as defaultWorkflowGateway, normalizeDialogueArtifact } from "../api/client";
import { ActionRequiredError, handleRequiredAction, isActionRequiredError, readActionRequired, withActionRequired } from '../api/actionRequired';
import type {
  AcceptanceDecision,
  ArtifactCandidate,
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
  DEFAULT_EXPORT_DESCRIPTION,
  decodeImage,
  message
} from "../workflow/presentation";
import type { AppProps, WorkflowCapabilities } from "./contracts";
import { dialogueCorrections } from "./dialogueCorrections";
import { readWorkflowLocation, readWorkflowStorage, writeWorkflowStorage, workflowStorageKey, type WorkflowLocation } from "../workflow/workflowLocation";
import { draftVoiceSelection } from "../workflow/voiceSelection";

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

class BookSnapshotError extends Error {
  readonly status?: number;
  constructor(reason: unknown) {
    super(message(reason));
    this.status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : undefined;
  }
}

const dialogueScanVersion = 6;

const publicWorkflowCapabilities: WorkflowCapabilities = {
  localDialogueAttribution: true,
  showExecutionBadge: true,
  showProviderCostReceipts: true,
  showVoiceModelControls: true,
  advancedDialogueRules: true,
};


// Own workflow state and commands in one place; pages receive typed subsets.
// Presentation values never select commands or alter accepted workflow state.
export function useWorkflowModel({
  gateway: suppliedGateway = defaultWorkflowGateway,
  maxImportBytes = 500_000_000,
  journey = publicJourney,
  workflowPersistenceNamespace,
  initialWorkflowLocation,
  onActionRequired,
  stepOverrides = {},
  renderHeader,
  renderLibraryActions,
  capabilities: capabilityOverrides = {},
  generationEstimatePolicy: generationEstimateOverrides = {},
}: AppProps) {
  if (!Number.isSafeInteger(maxImportBytes) || maxImportBytes <= 0 || maxImportBytes > 500_000_000) {
    throw new Error("maxImportBytes must be a positive integer at most 500000000");
  }
  const gateway = useMemo(() => onActionRequired
    ? withActionRequired(suppliedGateway, onActionRequired) : suppliedGateway,
  [suppliedGateway, onActionRequired]);
  const initialLocation = useRef({ namespace: workflowPersistenceNamespace, value: initialWorkflowLocation });
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
  const importLimitMB = new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 6 }).format(maxImportBytes / 1_000_000);

  const [productView, setProductView] = useState<ProductView>(() => productViewFromPath(window.location.pathname));

  const [home, setHomeState] = useState(true);
  const locationKey = workflowStorageKey("location", workflowPersistenceNamespace);
  const jobKey = workflowStorageKey("activeJob", workflowPersistenceNamespace);
  const navigationVersion = useRef(0);
  const [restoringLocation, setRestoringLocation] = useState(true);
  const [restoringJobScope, setRestoringJobScope] = useState(false);
  const [returnLocation, setReturnLocation] = useState<WorkflowLocation>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const readyLocationKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scopeRef = useRef(workflowPersistenceNamespace);
  scopeRef.current = workflowPersistenceNamespace;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(persistedSidebarCollapsed);

  const [snapshot, setSnapshot] = useState<WizardSnapshot>();

  const [books, setBooks] = useState<LocalBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState(false);

  const [libraryExports, setLibraryExports] = useState<LibraryExport[]>([]);

  const [libraryReady, setLibraryReady] = useState(false);

  const [libraryError, setLibraryError] = useState<string>();

  const [libraryLoading, setLibraryLoading] = useState(false);

  const [openingBookId, setOpeningBookId] = useState<string>();

  const [bookPendingDeletion, setBookPendingDeletion] = useState<LocalBook>();

  const [deletingBookId, setDeletingBookId] = useState<string>();

  const [file, setFile] = useState<File>();

  const [stage, setStage] = useState(0);

  const [busy, setBusy] = useState(() => {
    // A known return must not paint Home before the restoration effect starts.
    // These scoped hints select the loading view only; hydration still verifies
    // the book/job on the gateway. Explicit Home and Library retain precedence.
    const saved = initialWorkflowLocation
      ? { view: "create", home: false, bookId: initialWorkflowLocation.bookId }
      : readWorkflowLocation(locationKey);
    if (window.location.pathname === productPaths.library || saved?.home || saved?.view === "library") return false;
    return Boolean(initialWorkflowLocation?.activeJobId || readWorkflowStorage(jobKey) || saved?.bookId);
  });

  const [processingOverlaySuppressed, setProcessingOverlaySuppressed] = useState(false);

  const [failure, setFailure] = useState<{ message: string; scope?: "generate" }>();
  const error = failure?.message;
  const generationError = failure?.scope === "generate" ? error : undefined;
  const setError = useCallback((message?: string) => {
    setFailure(message ? { message } : undefined);
  }, []);

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

  const [extractionCandidate, setExtractionCandidate] = useState<ArtifactCandidate>();
  const [extractionPreview, setExtractionPreview] = useState<ExtractionPreview>();
  const extractionPreviewRequest = useRef(0);

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


  const [castingPreviewReady, setCastingPreviewReady] = useState(false);

  const [castingPreviewFingerprint, setCastingPreviewFingerprint] = useState<string>();

  const updateCastingPreview = useCallback((ready: boolean, fingerprint?: string) => { setCastingPreviewReady(ready); setCastingPreviewFingerprint(fingerprint); }, []);

  const [voiceModel, setVoiceModel] = useState("");

  const [language, setLanguage] = useState("");

  const [castLaunchPending, setCastLaunchPending] = useState(false);
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

  const [chapterFilter, setChapterFilter] = useState<"all" | "pending" | "generated">("pending");

  const [listeningChapterId, setListeningChapterId] = useState<string>();

  const [splitChapterId, setSplitChapterId] = useState<string>();

  const [exportChapterIds, setExportChapterIds] = useState<string[]>([]);

  const [exportTitle, setExportTitle] = useState("");

  const [exportAuthor, setExportAuthor] = useState("");

  const [exportDescription, setExportDescription] = useState(() => t(DEFAULT_EXPORT_DESCRIPTION));

  const exportBookId = useRef<string | undefined>(undefined);

  const [exportCover, setExportCover] = useState<File>();

  const [exportCoverPage, setExportCoverPage] = useState(1);

  const [exportPreset, setExportPreset] = useState<AudioExportPreset>("m4b-high");

  const [exportCoverPreviewUrl, setExportCoverPreviewUrl] = useState<string>();

  const [exporting, setExporting] = useState(false);

  const [revisingStages, setRevisingStages] = useState<string[]>([]);

  const booksRequest = useRef<{ gateway: typeof gateway; namespace?: string; promise: Promise<void> } | undefined>(undefined);
  const loadBooks = useCallback(() => {
    if (booksRequest.current?.gateway === gateway && booksRequest.current?.namespace === workflowPersistenceNamespace) return booksRequest.current.promise;
    setBooksError(false);
    setBooksLoading(true);
    const request = gateway.listBooks()
      .then((rows) => {
        if (booksRequest.current?.promise === request) setBooks(rows);
      })
      .catch(() => {
        if (booksRequest.current?.promise === request) setBooksError(true);
      })
      .finally(() => {
        if (booksRequest.current?.promise !== request) return;
        booksRequest.current = undefined;
        setBooksLoading(false);
      });
    booksRequest.current = { gateway, namespace: workflowPersistenceNamespace, promise: request };
    return request;
  }, [gateway, workflowPersistenceNamespace]);

  const libraryRequest = useRef<{ gateway: typeof gateway; namespace?: string; promise: Promise<void> } | undefined>(undefined);

  const reviewStripRef = useRef<HTMLDivElement | null>(null);
  const loadLibrary = useCallback(() => {
    if (libraryRequest.current?.gateway === gateway && libraryRequest.current?.namespace === workflowPersistenceNamespace) return libraryRequest.current.promise;
    setLibraryError(undefined);
    setLibraryLoading(true);
    const request = gateway.listLibrary()
      .then((rows) => { if (libraryRequest.current?.promise === request) setLibraryExports(rows); })
      .catch((reason) => { if (libraryRequest.current?.promise === request) setLibraryError(message(reason)); })
      .finally(() => {
        if (libraryRequest.current?.promise !== request) return;
        libraryRequest.current = undefined;
        setLibraryReady(true);
        setLibraryLoading(false);
      });
    libraryRequest.current = { gateway, namespace: workflowPersistenceNamespace, promise: request };
    return request;
  }, [gateway, workflowPersistenceNamespace]);

  const book = snapshot?.book;

  const completed = snapshot?.book.completedStages ?? [];

  const recoveryStageIndex = stageIndex("review");

  const routeStage = (requestedStage: number, current = snapshot) => (
    ["epub", "text"].includes(current?.book.sourceKind ?? "") && stages[requestedStage]?.builtin === "extract"
      ? stageIndex("dialogue")
      : current?.dialogueRecovery && requestedStage >= recoveryStageIndex
      ? recoveryStageIndex
      : requestedStage
  );

  const generateComplete = Boolean(snapshot?.generatedChapters.some((row) => row.current));

  const unlockedThrough = generateComplete
    ? stageIndex("export")
    : snapshot ? Math.min(stageIndex("generate"), Math.max(0, nextStage(completed))) : 0;

  const hasDraft = (stageId?: WizardStep) => {
    if (stageId === "extract") return Boolean(extractionCandidate);
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
    if (!reviewFinalCheck || !book || !reviewCandidate?.revision) {
      setReviewTranscriptPreview(undefined);
      setReviewPreviewLoading(false);
      return;
    }
    let disposed = false;
    setError("");
    setReviewPreviewLoading(true);
    const { policies, occurrencePolicies } = buildReviewPreviewPolicies(normalizeCandidateWarnings(reviewCandidate), reviewDecisions);
    const timer = window.setTimeout(() => {
      void gateway.previewReviewTranscript(
        book.id,
        String(reviewCandidate.revision),
        reviewPreviewPage,
        policies,
        ...(occurrencePolicies.length ? [occurrencePolicies] : []),
      ).then(async (preview) => {
        if (disposed) return;
        if (preview.imageUrl) await decodeImage(preview.imageUrl);
        if (!disposed) setReviewTranscriptPreview(preview);
      }).catch((reason) => {
        if (!disposed) {
          setReviewTranscriptPreview(undefined);
          setReviewFinalCheck(false);
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
  }, [book, gateway, reviewCandidate, reviewDecisions, reviewFinalCheck, reviewPreviewPage, setError]);

  useEffect(() => {
    setBooks([]);
    setLibraryExports([]);
    setLibraryReady(false);
    void loadBooks();
    void loadLibrary();
  }, [loadBooks, loadLibrary]);

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
      readyLocationKey.current = locationKey;
      navigationVersion.current += 1;
      setReturnLocation(undefined);
      setRestoringLocation(false);
      setRestoringJobScope(false);
      setBusy(false);
      setActiveJob(undefined);
      clearGenerationTracking();
      setProductView(next);
      if (next === "library") void loadLibrary();
    };
    window.addEventListener("popstate", restoreProductView);
    return () => window.removeEventListener("popstate", restoreProductView);
  }, [loadLibrary, locationKey]);

  useEffect(() => {
    let disposed = false;
    const version = navigationVersion.current;
    const current = () => !disposed && navigationVersion.current === version
      && scopeRef.current === workflowPersistenceNamespace;
    const hint = initialLocation.current.namespace === workflowPersistenceNamespace ? initialLocation.current.value : undefined;
    const saved: WorkflowLocation | undefined = hint
      ? { view: 'create', home: false, bookId: hint.bookId, stepId: hint.stepId }
      : readWorkflowLocation(locationKey);
    const id = hint?.activeJobId ?? readWorkflowStorage(jobKey);
    readyLocationKey.current = null;
    setRestoringLocation(true);
    setRestoringJobScope(Boolean(id));
    setReturnLocation(undefined);
    setError(undefined);
    setBusy(Boolean(id || saved?.bookId));
    setActiveJob(undefined);
    clearGenerationTracking();
    setSnapshot(undefined);
    setHomeState(true);
    const restore = async () => {
      // An explicit Home/Library visit takes precedence over an old active-job marker.
      if (saved && (window.location.pathname === productPaths.library || saved.home || saved.view === "library")) {
        setProductView(window.location.pathname === productPaths.library ? "library" : saved.view);
        return;
      }
      let job: Job | undefined;
      let restored: WizardSnapshot | undefined;
      if (saved?.bookId) {
        restored = await restoreBookView(saved.bookId, saved.stepId, current);
      }
      if (!current()) return;
      if (id) {
        try { job = await pollJobWithForegroundRefresh(gateway, id); }
        catch (reason) {
          if (!current()) return;
          if (!isRetryableJobPollError(reason)) writeWorkflowStorage(jobKey, null);
          throw reason;
        }
        if (!current()) return;
        const bookId = typeof job.result?.bookId === "string" ? job.result.bookId
          : typeof job.payload?.book_id === "string" ? job.payload.book_id : undefined;
        if (saved?.bookId && bookId && saved.bookId !== bookId) {
          writeWorkflowStorage(jobKey, null);
          return;
        }
        if (!restored && bookId) restored = await restoreBookView(bookId, saved?.stepId, current);
        if (!current()) return;
        const settings = job.payload?.settings as Record<string, unknown> | undefined;
        const unavailable = new Set(restored?.recordingScript?.summary.emptyChapterIds ?? []);
        const available = new Set(restored?.chapters
          .filter((row) => !unavailable.has(row.id))
          .map((row) => row.id));
        const requested = Array.isArray(settings?.chapterIds)
          ? [...new Set(settings.chapterIds.filter((id): id is string => typeof id === "string" && available.has(id)))]
          : [];
        const generationJob = job.kind === "v2:generate";
        const generation = generationJob && restored && requested.length > 0;
        if (generationJob && !generation) setSelectedChapters([]);
        if (generation && restored) {
          const ready = new Set(restored.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
          setChapterFilter(requested.every((id) => ready.has(id)) ? "generated" : "pending");
          setSelectedChapters(requested);
          if (["queued", "running"].includes(job.status)) {
            startGenerationTracking(restored, requested, job.started_at);
          }
        }
        setRestoringJobScope(false);
        await runJob(job, async (settled) => {
          if (!current()) return;
          const target = restored?.book.id ?? bookId;
          if (!target) return;
          const next = await restoreBookView(target, saved?.stepId, current);
          if (!current()) return;
          if ((generationJob || settled.kind === "v2:generate") && settled.status === "succeeded") {
            const completedRequest = requested.length ? requested
              : Array.isArray(settled.result?.chapters)
                ? settled.result.chapters.flatMap((row) => typeof row?.chapterId === "string" ? [row.chapterId] : []) : [];
            selectCompletedChapters(next, completedRequest);
          } else if (generation) {
            const ready = new Set(next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
            const pending = requested.filter((id) => !ready.has(id));
            if (pending.length) {
              // A worker may have published tracks before this tab reattached.
              setChapterFilter("pending");
              setSelectedChapters(pending);
            } else {
              selectUnfinishedChapters(next, requested);
            }
          }
        }, current);
      }
    };
    void restore().catch((reason) => {
      if (!current()) return;
      if (isActionRequiredError(reason) && reason.handled) return;
      const status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : undefined;
      if (reason instanceof BookSnapshotError && (status === 404 || status === 422) && saved?.bookId) {
        writeWorkflowStorage(jobKey, null);
        writeWorkflowStorage(locationKey, null);
        setHomeState(true);
      } else {
        setError(message(reason));
        setReturnLocation(saved ?? { view: "create", home: false });
      }
    }).finally(() => {
      if (!current()) return;
      readyLocationKey.current = locationKey;
      setBusy(false);
      clearGenerationTracking();
      setRestoringLocation(false);
      setRestoringJobScope(false);
    });
    return () => { disposed = true; };
    // Hydration consumes the current model; restoring is scoped to gateway and host identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, workflowPersistenceNamespace, restoreAttempt]);

  useEffect(() => {
    if (restoringLocation || returnLocation || readyLocationKey.current !== locationKey) return;
    writeWorkflowStorage(locationKey, JSON.stringify({
      view: productView, home,
      ...(book && !home ? { bookId: book.id, stepId: stages[stage]?.id } : {}),
    } satisfies WorkflowLocation));
  }, [book, home, locationKey, productView, restoringLocation, returnLocation, stage, stages]);

  // Extraction preview is a separate, lazy UI concern. A later-stage return must not
  // depend on PDF preview availability (including historical books without a filename).
  useEffect(() => {
    if (!book || home || productView !== "create" || stages[stage]?.builtin !== "extract"
      || extractionCandidate
      || (completed.includes("extract") && !revisingStages.includes("extract"))) return;
    let disposed = false;
    const request = ++extractionPreviewRequest.current;
    setRepresentatives([]);
    setExtractionPreview(undefined);
    void gateway.getRepresentativePages(book.id).then(async (pages) => {
      if (disposed || request !== extractionPreviewRequest.current) return;
      setRepresentatives(pages);
      const preview = await gateway.previewExtraction(book.id, pages[0]?.page ?? 1, method);
      if (!disposed && request === extractionPreviewRequest.current) setExtractionPreview(preview);
    }).catch((reason) => { if (!disposed && request === extractionPreviewRequest.current) setError(message(reason)); });
    return () => { disposed = true; };
  // Preview controls fetch their own chosen pages and methods.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, home, productView, stage, extractionCandidate, revisingStages, gateway]);

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

  async function hydrate(bookId: string, current = () => mounted.current
    && scopeRef.current === workflowPersistenceNamespace && gatewayRef.current === gateway) {
    const readSnapshot = () => gateway.getBookSnapshot(bookId).catch((reason) => {
      if (isActionRequiredError(reason)) throw reason;
      throw new BookSnapshotError(reason);
    });
    let next = await readSnapshot();
    if (!current()) return next;
    if (
      next.book.completedStages.includes("cast")
      && !next.recordingScript
      && !next.dialogueRecovery
    ) {
      await gateway.prepareRecordingScript(bookId);
      next = await readSnapshot();
      if (!next.recordingScript) throw new Error("Generate could not be prepared. Your approved work is unchanged.");
    }
    const pendingExtractionRevision = next.pendingCandidates?.extraction?.revision;
    const pendingDialogueRevision = next.pendingCandidates?.dialogue?.revision;
    const pendingReviewRevision = next.pendingCandidates?.review?.revision;
    const pendingCastRevision = next.pendingCandidates?.cast?.revision;
    // These immutable reads share the authoritative snapshot's revision IDs.
    // None depends on another result, so a return pays one read interval rather
    // than a round trip for every pending stage. Commit state only when all settle.
    const [pendingExtraction, pendingDialogue, pendingReview, pendingCast, hydratedDialogue] = await Promise.all([
      pendingExtractionRevision ? gateway.getStageCandidate(bookId, "extract", pendingExtractionRevision) : undefined,
      pendingDialogueRevision ? gateway.getStageCandidate(bookId, "dialogue", pendingDialogueRevision) : undefined,
      pendingReviewRevision ? gateway.getStageCandidate(bookId, "review", pendingReviewRevision) : undefined,
      pendingCastRevision ? gateway.getStageCandidate(bookId, "cast", pendingCastRevision) : undefined,
      next.book.completedStages.includes("extract") && !next.book.completedStages.includes("dialogue")
        ? gateway.previewDialogue(bookId, dialogueSettings(emptyDialogue, "fill-gaps"))
        : next.dialogue ?? emptyDialogue,
    ]);
    const pendingDialoguePreview = normalizeDialogueArtifact(pendingDialogue);
    const pendingNeedsPreflight = Boolean(
      pendingDialoguePreview?.conflicts?.length || pendingDialoguePreview?.structuralIssues?.length,
    );
    const stalePreflightCandidate = pendingNeedsPreflight && pendingDialoguePreview?.scanVersion !== dialogueScanVersion;
    if (!current()) return next;
    setSnapshot(next);
    setExtractionCandidate(pendingExtraction);
    setDialogue(pendingNeedsPreflight && !stalePreflightCandidate ? pendingDialoguePreview! : hydratedDialogue);
    setDialogueCandidate(pendingNeedsPreflight ? undefined : pendingDialogue);
    setDialogueInitialDecisions([]);
    setEditingAcceptedDialogue(false);
    setReviewCandidate(pendingReview);
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
    setListeningChapterId(undefined);
    const savedModel = (
      resumeMatchesProposal ? recoverableCast?.modelId : undefined
    ) ?? restoredCast?.voiceModel ?? next.voiceSelection.modelId ?? next.voiceModels[0]?.id;
    const supported = next.voiceModels.find((row) => row.id === savedModel)?.supportedLanguages ?? [];
    const detected = restoredCast?.detectedLanguage;
    const savedLanguage = (resumeMatchesProposal ? recoverableCast?.language : undefined) ?? restoredCast?.language ?? next.voiceSelection.language;
    const boundAuditions = resumeMatchesProposal || (restoredCast && restoredCast.phase !== "identity-review");
    const selection = boundAuditions
      ? { modelId: savedModel ?? "", language: savedLanguage ?? (detected && supported.includes(detected) ? detected : supported.includes("english") ? "english" : supported[0] ?? "") }
      : draftVoiceSelection(next.voiceModels, [savedModel, next.voiceSelection.modelId], [restoredCast?.language, detected, next.voiceSelection.language]);
    setVoiceModel(selection.modelId);
    setLanguage(selection.language);
    setNarrationLanguageConfirmed(Boolean(selection.language && (
      boundAuditions || restoredCast?.language === selection.language || detected === selection.language
    )));
    const newExportBook = exportBookId.current !== next.book.id;
    const unavailableChapters = new Set(next.recordingScript?.summary.emptyChapterIds ?? []);
    const availableChapterIds = next.chapters.map((row) => row.id).filter((id) => !unavailableChapters.has(id));
    const generatedChapterIds = new Set(next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
    const pendingChapterIds = availableChapterIds.filter((id) => !generatedChapterIds.has(id));
    const nextChapterFilter = newExportBook
      ? !pendingChapterIds.length && generatedChapterIds.size > 0 ? "generated" : "pending"
      : chapterFilter === "all" || (chapterFilter === "generated" && !generatedChapterIds.size && pendingChapterIds.length > 0) ? "pending" : chapterFilter;
    if (newExportBook || chapterFilter !== nextChapterFilter) setChapterFilter(nextChapterFilter);
    setSelectedChapters((current) => {
      if (newExportBook) return nextChapterFilter === "pending" ? pendingChapterIds : [];
      const visible = nextChapterFilter === "generated" ? generatedChapterIds : new Set(pendingChapterIds);
      return current.length ? current.filter((id) => visible.has(id)) : nextChapterFilter === "pending" ? pendingChapterIds : [];
    });
    exportBookId.current = next.book.id;
    setExportChapterIds((current) => {
      const playable = next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId);
      return newExportBook || !current.length ? playable : current.filter((id) => playable.includes(id));
    });
    setExportTitle((current) => newExportBook ? next.book.title || "" : current || next.book.title || "");
    setExportAuthor((current) => newExportBook ? next.book.author || "" : current || next.book.author || "");
    if (newExportBook) {
      setExportDescription(t(DEFAULT_EXPORT_DESCRIPTION));
      setExportCover(undefined);
      setExportCoverPage(1);
    }
    return next;
  }

  async function runJob(initial: Job, onSettled?: (job: Job) => Promise<void>, isCurrent = () => mounted.current && scopeRef.current === workflowPersistenceNamespace): Promise<Job> {
    let current = initial;
    let consecutivePollFailures = 0;
    setActiveJob(current);
    writeWorkflowStorage(jobKey, current.id);
    while (["queued", "running"].includes(current.status)) {
      setProgress(current.progress ?? 0);
      setProcessMessage(current.message ?? "");
      try {
        current = await pollJobWithForegroundRefresh(gateway, current.id);
        if (!isCurrent()) return current;
        consecutivePollFailures = 0;
      } catch (reason) {
        if (!isCurrent()) return current;
        if (!isRetryableJobPollError(reason)) {
          writeWorkflowStorage(jobKey, null);
          setActiveJob(undefined);
          throw reason;
        }
        consecutivePollFailures += 1;
        setProcessMessage(reconnectingJobMessage);
        await waitForNextJobPoll(Math.min(
          jobPollIntervalMs * 2 ** (consecutivePollFailures - 1),
          maximumJobPollBackoffMs,
        ));
        if (!isCurrent()) return current;
        continue;
      }
      setActiveJob(current);
      setProgress(current.progress ?? 0);
      setProcessMessage(current.message ?? "");
      if (["queued", "running"].includes(current.status)) {
        await waitForNextJobPoll(jobPollIntervalMs);
        if (!isCurrent()) return current;
      }
    }
    if (!isCurrent()) return current;
    writeWorkflowStorage(jobKey, null);
    setActiveJob(undefined);
    const action = current.status === 'failed' ? readActionRequired(current.action_required) : undefined;
    const actionError = action ? new ActionRequiredError(action) : undefined;
    if (actionError) {
      // Deliver host intervention even if the subsequent book refresh fails.
      handleRequiredAction(actionError, onActionRequired, {
        bookId: typeof current.payload?.book_id === 'string' ? current.payload.book_id : undefined,
        stage: current.kind?.startsWith('v2:') ? current.kind.slice(3) : undefined,
        jobId: current.id,
        settings: current.payload?.settings as Record<string, unknown> | undefined,
      });
    }
    // Reattachment must restore saved book context even when the worker failed.
    if (onSettled) await onSettled(current);
    if (actionError) throw actionError;
    if (current.status !== 'succeeded') throw new Error(current.error ?? `Job ${current.status}`);
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
    if (stageId === "cast" && showProcessingOverlay) {
      setCastLaunchPending(true);
      setProgress(0);
      setProcessMessage("");
    }
    setError(undefined);
    try {
      const initialJob = await gateway.processStage(book.id, stageId, settings);
      setCastLaunchPending(false);
      const job = await runJob(initialJob);
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
      setCastLaunchPending(false);
    }
  }

  async function acceptCandidate(stageId: ProcessableStage, candidate: { revision?: unknown; conflicts?: unknown[]; } | undefined, decisions: AcceptanceDecision[] = []) {
    if (!book || !candidate?.revision) return;
    if (stageId === "dialogue" && candidate.conflicts?.length) {
      setError("Choose how to read each overlapping match before continuing.");
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
      const candidate = extractionCandidate ?? await processCandidate("extract", { method });
      if (!candidate.revision) throw new Error("extract did not return a candidate revision");
      setBusy(true);
      setProcessMessage("Saving extracted text");
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
    const extension = file.name.split(".").pop()?.toLowerCase();
    const formatLimit = extension === "epub" ? 64 * 1024 * 1024
      : extension === "txt" || extension === "md" ? 20 * 1024 * 1024 : 500_000_000;
    const fileLimit = Math.min(maxImportBytes, formatLimit);
    if (file.size > fileLimit) {
      const size = new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 6 }).format(fileLimit / 1_000_000);
      setError(`Choose a file no larger than ${size} MB.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await gateway.importBook(file);
      const next = await hydrate(result.book.id);
      setRepresentatives(result.representativePages);
      setExtractionPreview(undefined);
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

  async function restoreBookView(bookId: string, stepId?: string, current = () => true) {
    const next = await hydrate(bookId, current);
    if (!current()) return next;
    const requested = stepId ? stages.findIndex((row) => row.id === stepId) : -1;
    const unlocked = next.generatedChapters.some((row) => row.current)
      ? stageIndex("export") : Math.min(stageIndex("generate"), nextStage(next.book.completedStages));
    setStage(routeStage(requested >= 0 && requested <= unlocked ? requested : nextStage(next.book.completedStages), next));
    if (window.location.pathname !== productPaths.create) window.history.replaceState({}, "", productPaths.create);
    setProductView("create");
    setHomeState(false);
    writeWorkflowStorage(locationKey, JSON.stringify({ view: "create", home: false, bookId, stepId: stages[requested >= 0 && requested <= unlocked ? requested : nextStage(next.book.completedStages)]?.id } satisfies WorkflowLocation));
    return next;
  }

  function setHome(next: boolean) {
    readyLocationKey.current = locationKey;
    navigationVersion.current += 1;
    setReturnLocation(undefined);
    setRestoringLocation(false);
    setRestoringJobScope(false);
    setBusy(false);
    setActiveJob(undefined);
    clearGenerationTracking();
    setHomeState(next);
  }

  function retryWorkflowReturn() {
    setRestoreAttempt((attempt) => attempt + 1);
  }

  async function openBook(local: LocalBook) {
    navigationVersion.current += 1;
    const version = navigationVersion.current;
    const current = () => navigationVersion.current === version && mounted.current
      && scopeRef.current === workflowPersistenceNamespace && gatewayRef.current === gateway;
    setReturnLocation(undefined);
    setRestoringLocation(false);
    setRestoringJobScope(false);
    setOpeningBookId(local.id);
    setBusy(true);
    setError(undefined);
    try {
      await restoreBookView(local.id, undefined, current);
    } catch (reason) {
      if (current()) setError(message(reason));
    } finally {
      if (current()) {
        setBusy(false);
        setOpeningBookId(undefined);
      }
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
    const request = ++extractionPreviewRequest.current;
    setBusy(true);
    try {
      const preview = await gateway.previewExtraction(book.id, page, selectedMethod);
      if (request === extractionPreviewRequest.current) setExtractionPreview(preview);
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

  function runDialogueTranscript(route: DialogueAttributionRoute, source = dialogue) {
    setDialogueProcessingRoute(route);
    setDialogueLaunchPending(true);
    setProcessMessage("Preparing speaker check");
    setProgress(0);
    setDialogueRouteChoiceOpen(false);
    const targets = availableAttributionTargets(source, attributionTargets);
    const strategy = targets.length ? dialogueStrategy : "narrate";
    const settings = {
      ...dialogueSettings(source, strategy, targets),
      attributionRoute: route,
    };
    setDialogueInitialDecisions([]);
    setEditingAcceptedDialogue(false);
    void processCandidate("dialogue", settings)
      .then(setDialogueCandidate)
      .catch((reason) => setError(message(reason)))
      .finally(() => setDialogueLaunchPending(false));
  }

  function continueAcceptedDialogue() {
    if (busy || !editingAcceptedDialogue || !snapshot?.activeArtifacts.dialogue) return;
    // Reviewing unchanged choices is navigation, not a new artifact acceptance.
    setDialogueCandidate(undefined);
    setDialogueInitialDecisions([]);
    setEditingAcceptedDialogue(false);
    setRevisingStages((current) => current.filter((row) => row !== "dialogue"));
    setStage(routeStage(
      Math.min(stageIndex("generate"), nextStage(snapshot.book.completedStages)),
      snapshot,
    ));
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
    if (dialogueStrategy === "narrate" || availableAttributionTargets(currentDialogue, attributionTargets).length === 0) {
      runDialogueTranscript("local");
      return;
    }
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
    if (availableAttributionTargets(currentDialogue, attributionTargets).length === 0) {
      runDialogueTranscript("local", currentDialogue);
      return;
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
      if (routing?.remote?.credentialConfigured) runDialogueTranscript("remote", currentDialogue);
      else setError("Speaker-check choices could not be loaded. Try again.");
      return;
    }
    const preferred = routing?.defaultRoute === "remote" && routing.remote?.credentialConfigured
      ? "remote"
      : "local";
    runDialogueTranscript(preferred, currentDialogue);
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
      setChapterFilter("pending");
      await hydrate(book.id);
      setSelectedChapters(partIds);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function generateChapters(chapterIds: string[]) {
    if (!book || !snapshot || snapshot.book.id !== book.id || busy) return;
    const unavailable = new Set(snapshot.recordingScript?.summary.emptyChapterIds ?? []);
    const available = new Set(snapshot.chapters.filter((row) => !unavailable.has(row.id)).map((row) => row.id));
    const current = new Set(snapshot.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
    const requestedChapterIds = [...new Set(chapterIds)].filter((id) => available.has(id) && !current.has(id));
    if (!requestedChapterIds.length) return;
    startGenerationTracking(snapshot, requestedChapterIds);
    setBusy(true);
    setProgress(0);
    setError(undefined);
    try {
      const completedJob = await runJob(await gateway.processStage(book.id, "generate", { chapterIds: requestedChapterIds, language }));
      const sample = generationSample(completedJob);
      if (sample) setGenerationSamples((current) => [sample, ...current].sort((left, right) => right.finishedAt - left.finishedAt).slice(0, 3));
      const next = await hydrate(book.id);
      selectCompletedChapters(next, requestedChapterIds);
    } catch (reason) {
      const detail = message(reason);
      setFailure(detail ? { message: detail, scope: "generate" } : undefined);
      try {
        const next = await hydrate(book.id);
        selectUnfinishedChapters(next, requestedChapterIds);
      } catch {
        // Keep the original failure and local selection when refresh is unavailable.
      }
    } finally {
      clearGenerationTracking();
      setBusy(false);
    }
  }

  function startGenerationTracking(next: WizardSnapshot, chapterIds: string[], startedAt?: string | null) {
    const unavailable = new Set(next.recordingScript?.summary.emptyChapterIds ?? []);
    const availableChapters = next.chapters.filter((chapter) => !unavailable.has(chapter.id));
    const estimates = new Map((next.recordingScript?.summary.chapters ?? []).map((chapter) => [chapter.chapterId, chapter.estimatedSeconds]));
    const selected = new Set(chapterIds);
    const parsedStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
    setGenerationRun({
      chapterIds,
      estimatedAudioSeconds: availableChapters
        .filter((chapter) => selected.has(chapter.id))
        .reduce((total, chapter) => total + (estimates.get(chapter.id) ?? (chapter.estimatedCharacters ?? 0) / 15), 0),
      historicalMultiplier: averageGenerationMultiplier(generationSamples),
      startedAtMs: Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now(),
    });
    setGenerationInProgress(true);
  }

  function clearGenerationTracking() {
    setGenerationInProgress(false);
    setGenerationRun(undefined);
  }

  function selectUnfinishedChapters(next: WizardSnapshot, chapterIds: string[]) {
    // Published current tracks are ready for Export, even if the overall job failed.
    // Retry only requested tracks that still lack current audio.
    const unavailable = new Set(next.recordingScript?.summary.emptyChapterIds ?? []);
    const available = new Set(next.chapters.filter((row) => !unavailable.has(row.id)).map((row) => row.id));
    const ready = new Set(next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
    const pending = chapterIds.filter((id) => available.has(id) && !ready.has(id));
    if (pending.length) {
      setChapterFilter("pending");
      setSelectedChapters(pending);
    } else {
      setSelectedChapters([]);
      selectCompletedChapters(next, chapterIds);
    }
  }

  function selectCompletedChapters(next: WizardSnapshot, chapterIds: string[]) {
    const requested = new Set(chapterIds);
    const playable = new Set(next.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
    const completed = next.chapters.filter((row) => requested.has(row.id) && playable.has(row.id)).map((row) => row.id);
    if (!completed.length) return;
    setChapterFilter("generated");
    setSelectedChapters(completed);
    setExportChapterIds(completed);
  }

  function continueToExport(chapterIds?: string[]) {
    const playable = new Set(snapshot?.generatedChapters.filter((row) => row.current).map((row) => row.chapterId));
    const selected = chapterIds ? new Set(chapterIds) : playable;
    const chapters = (snapshot?.chapters ?? []).filter((row) => playable.has(row.id) && selected.has(row.id)).map((row) => row.id);
    if (!chapters.length) return;
    setExportChapterIds(chapters);
    setStage(stageIndex("export"));
  }

  async function exportCurrent() {
    if (!book || !snapshot) return;
    const selected = new Set(exportChapterIds);
    const chapters = snapshot.generatedChapters.filter((row) => row.current && selected.has(row.chapterId)).map((row) => ({ chapterId: row.chapterId, revision: row.revision }));
    if (!chapters.length) return;
    setExporting(true);
    try {
      const options = { title: exportTitle.trim(), author: exportAuthor.trim(), description: exportDescription.trim(), cover: exportCover, coverPage: exportCoverPage, preset: exportPreset };
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
    readyLocationKey.current = locationKey;
    navigationVersion.current += 1;
    setReturnLocation(undefined);
    setRestoringLocation(false);
    setRestoringJobScope(false);
    setBusy(false);
    setActiveJob(undefined);
    clearGenerationTracking();
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
  return { continueAcceptedDialogue, castLaunchPending, importLimitMB, extractionCandidate, retryWorkflowReturn, returnLocation, restoringLocation, restoringJobScope, castingPreviewFingerprint, acceptCandidate, activeBoundary, activeJob, activeJourneyStep, activeOccurrence, activeReviewGroup, activeWarning, attributionTargets, book, bookPendingDeletion, books, booksError, booksLoading, refreshBooks: loadBooks, boundaryDecisions, busy, cancelActiveJobLabel, cancelActiveStageJob, cancelRequestPending, capabilities, castCandidate, castGenerationPaused, castingPreviewReady, chapterFilter, completed, confirmDefaultVoices, confirmedVoiceRoutes, continueToExport, conflictChoices, deleteBook, deletingBookId, deletingVoiceRevision, designingVoices, dialogue, dialogueCandidate, dialogueInitialDecisions, dialogueLaunchPending, dialogueProcessing, dialogueProcessingRoute, dialogueRouteChoiceOpen, dialogueRulesOpen, dialogueStrategy, editingAcceptedDialogue, editingCast, error, exportAuthor, exportChapterIds, exportCover, exportCoverPage, exportCoverPreviewUrl, exportDescription, exportCurrent, exportPreset, exportTitle, exporting, extractionPreview, extractionTransition, file, gateway, generateChapters, generateComplete, generationError, generationEstimatePolicy, generationInProgress, generationReady, generationRemaining, generationRun, generationSamples, hasDraft, home, hydrate, identityDecisions, importBook, language, libraryError, libraryExports, libraryLoading, libraryReady, refreshLibrary: loadLibrary, listeningChapterId, method, narrationLanguageConfirmed, narratorDirection, navigateProduct, openBook, openLibraryItem, openingBookId, previewPage, processAndPublishExtraction, processCandidate, processMessage, processingOverlaySuppressed, productView, progress, rebuildDialogueFromRecovery, recoveringDownstreamDialogue, refreshDialogue, regeneratingCharacterId, renderHeader, renderLibraryActions, reopenAcceptedDialogueReview, representatives, requestDialogueTranscript, resolvedLabels, revealLibraryItem, reviewCandidate, reviewDecisions, reviewFinalCheck, reviewPreviewLoading, reviewPreviewPage, reviewStripRef, reviewTranscriptPreview, reviewTransition, revisingStages, routeStage, runDialogueTranscript, selectedChapters, setActiveBoundary, setActiveOccurrence, setActiveReviewGroup, setActiveWarning, setAttributionTargets, setBookPendingDeletion, setBoundaryDecisions, setCastCandidate, setCastGenerationPaused, setChapterFilter, setConfirmDefaultVoices, setConfirmedVoiceRoutes, setConflictChoices, setDeletingVoiceRevision, setDesigningVoices, setDialogue, setDialogueCandidate, setDialogueInitialDecisions, setDialogueRouteChoiceOpen, setDialogueRulesOpen, setDialogueStrategy, setEditingAcceptedDialogue, setEditingCast, setError, setExportAuthor, setExportChapterIds, setExportCover, setExportCoverPage, setExportDescription, setExportPreset, setExportTitle, setFile, setHome, setIdentityDecisions, setLanguage, setListeningChapterId, setMethod, setNarrationLanguageConfirmed, setNarratorDirection, setProcessMessage, setProgress, setRegeneratingCharacterId, setResolvedLabels, setReviewCandidate, setReviewDecisions, setReviewFinalCheck, setReviewPreviewPage, setReviewTransition, setRevisingStages, setSelectedChapters, setSplitChapterId, setStage, setStructuralChoices, setUploadingCharacterId, setVoiceModel, setVoiceRoutes, setVoiceSelections, showCancelActiveJob, showWizard, sidebarCollapsed, snapshot, splitChapterId, splitLongChapter, stage, stageIndex, stages, stepOverrides, structuralChoices, t, toggleSidebar, uiLocale, unlockedThrough, updateCastingPreview, uploadingCharacterId, voiceModel, voiceRoutes, voiceSelections };
}

export type WorkflowModel = ReturnType<typeof useWorkflowModel>;
