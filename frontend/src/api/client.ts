import type {
  AudioExportOptions,
  DialogueArtifact,
  DialogueExample,
  DialogueSettings,
  ExtractionMethod,
  ExtractionPreview,
  ImportResult,
  Job,
  LibraryExport,
  LocalBook,
  M4BDownload,
  M4BExportChapter,
  M4BExportOptions,
  RecordingScriptArtifact,
  AcceptanceDecision,
  ProcessableStage,
  StageCandidate,
  StageSettings,
  WorkflowGateway,
  WizardSnapshot,
  WizardStage,
} from "./contracts";
import { dialogueReaderAssignments } from "../workflow/dialogue";

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly jobId?: string) {
    super(message);
  }
}

export class HttpWizardApi implements WorkflowGateway {
  constructor(
    private readonly baseUrl = "/api",
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async request<T>(path: string, init?: RequestInit, timeoutMs: number | null = 30_000): Promise<T> {
    const headers = init?.body instanceof FormData
      ? init.headers
      : { "Content-Type": "application/json", ...init?.headers };
    const signal = init?.signal ?? (timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs));
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      const detail = payload?.detail;
      const detailMessage = apiErrorMessage(detail);
      throw new ApiError(
        detailMessage || `API ${response.status}: ${response.statusText}`,
        response.status,
        detail && typeof detail === "object" && "jobId" in detail ? String(detail.jobId) : undefined,
      );
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  listBooks(): Promise<LocalBook[]> {
    return this.request("/books");
  }

  deleteBook(bookId: string): Promise<void> {
    return this.request(`/books/${bookId}`, { method: "DELETE" });
  }

  getRepresentativePages(bookId: string) {
    return this.request<ImportResult["representativePages"]>(`/books/${bookId}/extraction/representative-pages`);
  }

  async importBook(file: File): Promise<ImportResult> {
    const body = new FormData();
    body.append("file", file);
    const raw = await this.request<Record<string, unknown>>("/books/import", { method: "POST", body });
    return {
      book: raw.book as LocalBook,
      representativePages: raw.representativePages as ImportResult["representativePages"],
      duplicate: Boolean(raw.duplicate),
    };
  }

  async getBookSnapshot(bookId: string): Promise<WizardSnapshot> {
    const raw = await this.request<Record<string, unknown>>(`/books/${bookId}/snapshot`);
    const rawBook = raw.book as Record<string, unknown>;
    const activeArtifacts = raw.activeArtifacts as WizardSnapshot["activeArtifacts"] ?? {};
    const completedStages: WizardStage[] = ["import"];
    const activeStageKinds: Array<[keyof typeof activeArtifacts, WizardStage]> = [
      ["extraction", "extract"],
      ["dialogue", "dialogue"],
      ["review", "review"],
      ["cast", "cast"],
      ["enrichment", "enrich"],
    ];
    for (const [kind, stage] of activeStageKinds) {
      if (activeArtifacts[kind]) completedStages.push(stage);
    }
    const dialogue = normalizeDialogue(raw.dialogue);
    const reviewWarnings = Array.isArray(raw.reviewWarnings)
      ? raw.reviewWarnings as Array<Record<string, unknown>>
      : [];
    const review = raw.reviewInspection as Record<string, unknown> | undefined;
    return {
      book: {
        id: String(rawBook.id ?? bookId),
        title: String(rawBook.title ?? "Untitled book"),
        author: String(rawBook.author ?? ""),
        filename: String(rawBook.source_name ?? ""),
        pageCount: rawBook.page_count == null ? undefined : Number(rawBook.page_count),
        completedStages,
      },
      activeArtifacts,
      pendingCandidates: raw.pendingCandidates as WizardSnapshot["pendingCandidates"] ?? {},
      dialogue,
      warnings: reviewWarnings.map(normalizeWarning),
      boundaryCandidates: Array.isArray(raw.boundaryCandidates)
        ? raw.boundaryCandidates as WizardSnapshot["boundaryCandidates"]
        : [],
      reviewInspection: {
        decisions: Array.isArray(review?.decisions)
          ? (review.decisions as Array<Record<string, unknown>>).map((row) => ({
              occurrenceIds: Array.isArray(row.occurrenceIds)
                ? row.occurrenceIds.map(String)
                : row.occurrenceId == null ? [] : [String(row.occurrenceId)],
              action: String(row.action) as NonNullable<WizardSnapshot["reviewInspection"]>["decisions"][number]["action"],
              provenance: "user" as const,
            }))
          : [],
        boundaryDecisions: Array.isArray(review?.boundaryDecisions)
          ? review.boundaryDecisions as NonNullable<WizardSnapshot["reviewInspection"]>["boundaryDecisions"]
          : [],
        consequences: review?.consequences as Record<string, unknown> ?? {},
        history: Array.isArray(review?.history)
          ? review.history as NonNullable<WizardSnapshot["reviewInspection"]>["history"]
          : [],
      },
      cast: hasRevision(raw.cast) ? raw.cast as unknown as WizardSnapshot["cast"] : undefined,
      voiceModels: Array.isArray(raw.voiceModels) ? raw.voiceModels as WizardSnapshot["voiceModels"] : [],
      voiceSelection: raw.voiceSelection as WizardSnapshot["voiceSelection"] ?? {},
      enrichment: hasRevision(raw.enrichment) ? raw.enrichment as unknown as WizardSnapshot["enrichment"] : undefined,
      recordingScript: hasRevision(raw.recordingScript)
        ? raw.recordingScript as unknown as WizardSnapshot["recordingScript"]
        : undefined,
      chapters: Array.isArray(raw.chapters) ? raw.chapters as WizardSnapshot["chapters"] : [],
      generatedChapters: Array.isArray(raw.generatedChapters)
        ? (raw.generatedChapters as Array<Record<string, unknown>>).map((chapter) => ({
            ...chapter,
            segments: Array.isArray(chapter.segments)
              ? chapter.segments.map((segment) => {
                  const row = segment as Record<string, unknown>;
                  return {
                    ...row,
                    sourceSpanId: Array.isArray(row.sourceSpanIds)
                      ? row.sourceSpanIds.join(", ")
                      : row.sourceSpanId,
                  };
                })
              : chapter.segments,
          })) as WizardSnapshot["generatedChapters"]
        : [],
      history: raw.history as WizardSnapshot["history"] ?? {},
    };
  }

  previewExtraction(bookId: string, page: number, method: ExtractionMethod): Promise<ExtractionPreview> {
    return this.request(`/books/${bookId}/extraction/preview`, {
      method: "POST",
      body: JSON.stringify({ page, method }),
    });
  }

  async previewDialogue(bookId: string, settings: DialogueSettings): Promise<DialogueArtifact> {
    const raw = await this.request<Record<string, unknown>>(`/books/${bookId}/dialogue/preview`, {
      method: "POST",
      body: JSON.stringify(serializeDialogueSettings(settings, false)),
    });
    return normalizeDialogue(raw, settings) ?? emptyDialogue(settings);
  }

  previewReviewBulk(bookId: string, revision: string, occurrenceId: string, action: import('./contracts').ReviewCapability): Promise<Record<string, unknown>> {
    return this.request(`/books/${bookId}/review/bulk-preview`, { method: 'POST', body: JSON.stringify({ revision, occurrenceId, action }) });
  }

  previewReviewTranscript(bookId: string, revision: string, page: number, policies: import('./contracts').ReviewTranscriptPolicy[]): Promise<import('./contracts').ReviewTranscriptPreview> {
    return this.request(`/books/${bookId}/review/transcript-preview`, {
      method: 'POST',
      body: JSON.stringify({ revision, page, policies }),
    });
  }

  async processStage<S extends ProcessableStage>(bookId: string, stage: S, settings: StageSettings[S]): Promise<Job> {
    const payload = stage === "dialogue"
      ? serializeDialogueSettings(settings as DialogueSettings)
      : settings;
    try {
      return await this.request(`/books/${bookId}/stages/${stage}/process`, {
        method: "POST",
        body: JSON.stringify({ settings: payload }),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.jobId) {
        return this.getJob(error.jobId);
      }
      throw error;
    }
  }

  prepareRecordingScript(bookId: string): Promise<RecordingScriptArtifact> {
    return this.request(`/books/${bookId}/recording-script/prepare`, { method: "POST" });
  }

  splitRecordingScriptChapter(
    bookId: string,
    chapterId: string,
  ): Promise<RecordingScriptArtifact> {
    return this.request(
      `/books/${bookId}/recording-script/chapters/${encodeURIComponent(chapterId)}/split`,
      { method: "POST" },
    );
  }

  getStageCandidate<S extends ProcessableStage>(bookId: string, stage: S, revision: string): Promise<StageCandidate[S]> {
    return this.request(`/books/${bookId}/stages/${stage}/candidates/${revision}`);
  }

  uploadVoiceSample(
    bookId: string,
    castRevision: string,
    characterId: string,
    file: File,
    referenceText: string,
  ): Promise<import("./contracts").CastArtifact> {
    const body = new FormData();
    body.append("file", file);
    body.append("reference_text", referenceText);
    return this.request(
      `/books/${bookId}/stages/cast/candidates/${castRevision}/voices/${encodeURIComponent(characterId)}/upload`,
      { method: "POST", body },
      // Local audition generation is synchronous; aborting can hide an artifact the server committed.
      null,
    );
  }

  transcribeVoiceSample(bookId: string, file: File): Promise<import("./contracts").VoiceSampleTranscript> {
    const body = new FormData();
    body.append("file", file);
    // Local transcription can legitimately take longer than the generic request timeout.
    return this.request(`/books/${bookId}/voice-samples/transcribe`, { method: "POST", body }, null);
  }

  deleteVoiceAudition(
    bookId: string,
    castRevision: string,
    characterId: string,
    voiceRevision: string,
  ): Promise<import("./contracts").CastArtifact> {
    return this.request(
      `/books/${bookId}/stages/cast/candidates/${castRevision}/voices/${encodeURIComponent(characterId)}/${encodeURIComponent(voiceRevision)}`,
      { method: "DELETE" },
    );
  }

  acceptStage(
    bookId: string,
    stage: ProcessableStage,
    revision: string,
    decisions: AcceptanceDecision[] = [],
  ): Promise<void> {
    return this.request(`/books/${bookId}/stages/${stage}/accept`, {
      method: "POST",
      body: JSON.stringify({ revision, decisions }),
    });
  }

  getJob(jobId: string): Promise<Job> {
    return this.request(`/jobs/${jobId}`);
  }

  listBookJobs(bookId: string): Promise<Job[]> {
    return this.request(`/books/${bookId}/jobs`);
  }

  cancelJob(jobId: string): Promise<Job> {
    return this.request(`/jobs/${jobId}/cancel`, { method: "POST" });
  }

  openChapterAudio(bookId: string, chapterId: string, revision: string): Promise<void> {
    return this.request(`/books/${bookId}/chapters/${chapterId}/${revision}/audio/open`, {
      method: "POST",
    });
  }

  private async submitAudioExport(
    bookId: string,
    chapters: M4BExportChapter[],
    options: M4BExportOptions,
    endpoint: "audio" | "m4b",
    headers?: HeadersInit,
  ): Promise<Response> {
    const body = new FormData();
    body.append("chapters", JSON.stringify(chapters));
    if (options.title) body.append("title", options.title);
    if (options.author) body.append("author", options.author);
    if (options.cover) body.append("cover", options.cover);
    if (options.coverPage) body.append("coverPage", String(options.coverPage));
    if ("preset" in options) body.append("preset", (options as AudioExportOptions).preset);
    const response = await this.fetcher(`${this.baseUrl}/books/${bookId}/exports/${endpoint}`, {
      method: "POST",
      body,
      headers,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new ApiError(apiErrorMessage(payload?.detail) || `API ${response.status}: ${response.statusText}`, response.status);
    }
    return response;
  }

  async createM4bExport(
    bookId: string,
    chapters: M4BExportChapter[],
    options: M4BExportOptions = {},
  ): Promise<LibraryExport> {
    const response = await this.submitAudioExport(
      bookId,
      chapters,
      options,
      "m4b",
      { Accept: "application/json" },
    );
    return response.json() as Promise<LibraryExport>;
  }

  async createAudioExport(
    bookId: string,
    chapters: M4BExportChapter[],
    options: AudioExportOptions,
  ): Promise<LibraryExport> {
    const response = await this.submitAudioExport(
      bookId,
      chapters,
      options,
      "audio",
      { Accept: "application/json" },
    );
    return response.json() as Promise<LibraryExport>;
  }

  async exportM4b(bookId: string, chapters: M4BExportChapter[], options: M4BExportOptions = {}): Promise<M4BDownload> {
    const response = await this.submitAudioExport(bookId, chapters, options, "m4b");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const encoded = disposition.match(/filename\*=utf-8''([^;]+)/i)?.[1];
    const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
    return {
      blob: await response.blob(),
      filename: encoded ? decodeURIComponent(encoded) : quoted || "Meowdiobooks.m4b",
    };
  }

  listLibrary(): Promise<LibraryExport[]> {
    return this.request("/library");
  }

  openLibraryExport(exportId: string): Promise<void> {
    return this.request(`/library/${exportId}/open`, { method: "POST" });
  }

  revealLibraryExport(exportId: string): Promise<void> {
    return this.request(`/library/${exportId}/reveal`, { method: "POST" });
  }
}

function apiErrorMessage(detail: unknown): string | undefined {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((row) => apiErrorMessage(row)).filter(Boolean);
    return messages.length ? messages.join(" ") : undefined;
  }
  if (!detail || typeof detail !== "object") return undefined;
  if ("invalidChapterIds" in detail) {
    return "Some selected chapters are no longer available. Refresh Export and try again.";
  }
  if ("message" in detail && typeof detail.message === "string") return detail.message;
  if ("msg" in detail && typeof detail.msg === "string") return detail.msg;
  return undefined;
}

function hasRevision(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "revision" in value);
}

function emptyDialogue(settings: DialogueSettings): DialogueArtifact {
  return {
    regexes: [],
    openSpeakerPatterns: settings.openSpeakerPatterns,
    strategy: settings.strategy,
    summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 },
    examples: [],
    conflicts: [],
    resolvedConflicts: [],
    ...(settings.conflictResolutions?.length
      ? { conflictResolutions: settings.conflictResolutions }
      : {}),
  };
}

function normalizeDialogue(value: unknown, settings?: DialogueSettings): DialogueArtifact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const profiles = Array.isArray(raw.profiles) ? raw.profiles as Array<Record<string, unknown>> : [];
  const configured = new Map((settings?.regexes ?? []).map((row) => [row.id, row]));
  const regexes = profiles.map((profile) => {
    const id = String(profile.id ?? "");
    const prior = configured.get(id);
    return {
      id,
      label: String(profile.label ?? prior?.label ?? id),
      pattern: String(profile.pattern ?? prior?.pattern ?? ""),
      flags: String(profile.flags ?? prior?.flags ?? ""),
      priority: Number(profile.priority ?? prior?.priority ?? 0),
      enabled: Boolean(profile.enabled ?? prior?.enabled ?? true),
      builtIn: !(profile.custom ?? (prior && !prior.builtIn)),
      matchCount: Number(profile.matchCount ?? 0),
      examples: normalizeExamples(profile.examples),
    };
  });
  const summary = raw.resultSummary as Record<string, unknown> ?? raw.summary as Record<string, unknown> ?? {};
  const explicitTurns = Number(summary.explicitTurns ?? 0);
  const openSpeakerTurns = Number(summary.openSpeakerTurns ?? 0);
  const unlabeledCandidates = Number(summary.unlabelledCandidates ?? summary.unlabeledCandidates ?? 0);
  const spans = Array.isArray(raw.spans) ? raw.spans : Array.isArray(raw.acceptedMatches) ? raw.acceptedMatches : [];
  const aiWindowCount = Array.isArray(raw.aiWindows) ? raw.aiWindows.length : 0;
  const userCorrectionCount = Array.isArray(raw.userCorrections) ? raw.userCorrections.length : 0;
  return {
    scanVersion: raw.scanVersion == null ? undefined : Number(raw.scanVersion),
    revision: raw.revision == null ? undefined : String(raw.revision),
    extractionRevision: raw.extractionRevision == null ? undefined : String(raw.extractionRevision),
    strategy: String(raw.strategy ?? settings?.strategy) === "narrate" ? "narrate" : "fill-gaps",
    attributionTargets: Array.isArray(raw.attributionTargets) ? raw.attributionTargets as DialogueArtifact["attributionTargets"] : settings?.attributionTargets ?? ["open-speakers", "unlabelled-candidates"],
    regexes,
    openSpeakerPatterns: Array.isArray(raw.openSpeakerPatterns)
      ? raw.openSpeakerPatterns.map(String)
      : settings?.openSpeakerPatterns ?? [],
    summary: {
      totalTurns: Number(summary.totalTurns ?? explicitTurns + openSpeakerTurns + unlabeledCandidates),
      regexClaims: Number(summary.regexClaims ?? explicitTurns + openSpeakerTurns + unlabeledCandidates),
      explicitTurns,
      openSpeakerTurns,
      unlabeledCandidates,
      conflicts: Number(summary.conflicts ?? 0),
      structuralIssues: Number(summary.structuralIssues ?? 0),
      continuedTurns: Number(summary.continuedTurns ?? 0),
      aiAttributed: Number(summary.aiAttributed ?? 0),
      aiContributions: Number(summary.aiContributions ?? Math.max(0, aiWindowCount - userCorrectionCount)),
      unresolved: Number(summary.unresolved ?? 0),
      userCorrected: Number(summary.userCorrected ?? 0),
    },
    readerAssignments: dialogueReaderAssignments(spans as Array<Record<string, unknown>>),
    examples: normalizeExamples(spans).filter((row) => row.origin !== "narration").slice(0, 12),
    conflicts: normalizeDialogueConflicts(raw.conflicts),
    resolvedConflicts: normalizeDialogueConflicts(raw.resolvedConflicts),
    conflictResolutions: Array.isArray(raw.conflictResolutions)
      ? raw.conflictResolutions as DialogueArtifact["conflictResolutions"]
      : settings?.conflictResolutions ?? [],
    structuralIssues: normalizeStructuralIssues(raw.structuralIssues),
    resolvedStructuralIssues: normalizeStructuralIssues(raw.resolvedStructuralIssues),
    structuralResolutions: Array.isArray(raw.structuralResolutions)
      ? raw.structuralResolutions as DialogueArtifact["structuralResolutions"]
      : settings?.structuralResolutions ?? [],
    routing: normalizeDialogueRouting(raw.routing),
    remoteUsage: normalizeRemoteUsage(raw.remoteUsage),
    accepted: Boolean(raw.accepted),
  };
}

function normalizeRemoteUsage(value: unknown): DialogueArtifact["remoteUsage"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const estimatedCostUsd = Number(raw.estimatedCostUsd);
  const modelDisplayName = String(raw.modelDisplayName ?? "").trim() || "Remote model";
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
    return undefined;
  }
  return {
    inputTokens: Math.max(0, Number(raw.inputTokens ?? raw.promptTokens) || 0),
    cachedInputTokens: Math.max(
      0,
      Number(raw.cachedInputTokens ?? raw.cachedPromptTokens) || 0,
    ),
    outputTokens: Math.max(0, Number(raw.outputTokens ?? raw.completionTokens) || 0),
    estimatedCostUsd,
    modelProfile: String(raw.modelProfile ?? ""),
    modelDisplayName,
    providerModels: Array.isArray(raw.providerModels)
      ? raw.providerModels.map(String).filter(Boolean)
      : [],
  };
}

function normalizeDialogueRouting(value: unknown): DialogueArtifact["routing"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const local = raw.local as Record<string, unknown> | undefined;
  const remote = raw.remote as Record<string, unknown> | undefined;
  if (!local) return undefined;
  return {
    targetCount: Number(raw.targetCount ?? 0),
    largeReviewThreshold: Number(raw.largeReviewThreshold ?? 100),
    shouldPrompt: Boolean(raw.shouldPrompt),
    defaultRoute: raw.defaultRoute === "remote" ? "remote" : "local",
    local: {
      displayName: String(local.displayName ?? "Local model"),
      apiCostUsd: Number(local.apiCostUsd ?? 0),
    },
    remote: remote ? {
      displayName: String(remote.displayName ?? "Remote model"),
      domain: String(remote.domain ?? ""),
      credentialConfigured: Boolean(remote.credentialConfigured),
      apiKeyEnvironmentVariable: String(remote.apiKeyEnvironmentVariable ?? ""),
      estimatedCostUsd: Number(remote.estimatedCostUsd ?? 0),
      falseNamesReductionPercent: remote.falseNamesReductionPercent == null ? undefined : Number(remote.falseNamesReductionPercent),
      speakerRecallImprovementPercent: remote.speakerRecallImprovementPercent == null ? undefined : Number(remote.speakerRecallImprovementPercent),
    } : null,
  };
}

function normalizeStructuralIssues(value: unknown): NonNullable<DialogueArtifact["structuralIssues"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const rawInterpretations = row.interpretations as Record<string, unknown> | undefined;
    if (String(row.kind) !== "interrupted-turn" || !rawInterpretations) return [];
    const normalizeClaims = (action: string) => {
      const claims = rawInterpretations[action];
      if (!Array.isArray(claims)) return [];
      return claims.map((claim) => {
        const item = claim as Record<string, unknown>;
        return {
          matchId: String(item.matchId ?? ""),
          profileId: String(item.profileId ?? row.profileId ?? ""),
          page: Number(item.page ?? row.page ?? 0),
          source: String(item.source ?? ""),
          spokenText: String(item.text ?? ""),
          speakerLabel: item.sourceSpeakerLabel == null ? null : String(item.sourceSpeakerLabel),
        };
      });
    };
    return [{
      id: String(row.id ?? ""),
      kind: "interrupted-turn" as const,
      profileId: String(row.profileId ?? ""),
      page: Number(row.page ?? 0),
      source: String(row.source ?? ""),
      contextBefore: row.contextBefore == null ? undefined : String(row.contextBefore),
      contextAfter: row.contextAfter == null ? undefined : String(row.contextAfter),
      outerSpeakerLabel: row.outerSpeakerLabel == null ? null : String(row.outerSpeakerLabel),
      innerSpeakerLabels: Array.isArray(row.innerSpeakerLabels) ? row.innerSpeakerLabels.map(String) : [],
      availableActions: ["split", "keep-together", "narration"] as const,
      interpretations: {
        split: normalizeClaims("split"),
        "keep-together": normalizeClaims("keep-together"),
        narration: normalizeClaims("narration"),
      },
      selectedAction: ["split", "keep-together", "narration"].includes(String(row.selectedAction))
        ? row.selectedAction as "split" | "keep-together" | "narration"
        : undefined,
    }];
  });
}

export function normalizeDialogueArtifact(value: unknown): DialogueArtifact | undefined {
  return normalizeDialogue(value);
}

function normalizeDialogueConflicts(value: unknown): NonNullable<DialogueArtifact["conflicts"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const profileIds = Array.isArray(row.profileIds) ? row.profileIds.map(String) : [];
    const rawClaims = Array.isArray(row.claims) ? row.claims as Array<Record<string, unknown>> : [];
    if (profileIds.length !== 2 || rawClaims.length !== 2) return [];
    const claims = rawClaims.map((claim) => ({
      matchId: String(claim.matchId ?? ""),
      profileId: String(claim.profileId ?? ""),
      page: Number(claim.page ?? row.page ?? 0),
      source: String(claim.source ?? ""),
      spokenText: String(claim.text ?? ""),
      speakerLabel: claim.sourceSpeakerLabel == null ? null : String(claim.sourceSpeakerLabel),
      contextBefore: claim.contextBefore == null ? undefined : String(claim.contextBefore),
      contextAfter: claim.contextAfter == null ? undefined : String(claim.contextAfter),
    }));
    return [{
      id: String(row.id ?? ""),
      groupId: String(row.groupId ?? `profiles:${profileIds.join(":")}`),
      profileIds: profileIds as [string, string],
      page: Number(row.page ?? claims[0].page),
      claims: claims as [typeof claims[number], typeof claims[number]],
      winnerProfileId: row.winnerProfileId == null ? undefined : String(row.winnerProfileId),
    }];
  });
}

function normalizeExamples(value: unknown): DialogueExample[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw as Record<string, unknown>;
    const status = String(row.speakerStatus ?? "unlabelled");
    return {
      spanId: String(row.spanId ?? row.id ?? ""),
      page: Number(row.page ?? 0),
      source: String(row.source ?? ""),
      spokenText: String(row.text ?? row.spokenText ?? ""),
      speakerLabel: row.sourceSpeakerLabel == null ? null : String(row.sourceSpeakerLabel),
      speakerStatus: (["explicit", "open", "unlabelled", "ai", "user", "unresolved"].includes(status)
        ? status
        : "unlabelled") as DialogueExample["speakerStatus"],
      origin: String(row.origin ?? row.profileId ?? "regex"),
      contextBefore: row.contextBefore == null ? undefined : String(row.contextBefore),
      contextAfter: row.contextAfter == null ? undefined : String(row.contextAfter),
    };
  });
}

function normalizeWarning(raw: Record<string, unknown>): WizardSnapshot["warnings"][number] {
  const occurrences = Array.isArray(raw.occurrences) ? raw.occurrences as Array<Record<string, unknown>> : [];
  return {
    id: String(raw.id ?? raw.kind ?? "warning"),
    kind: String(raw.kind ?? "review-warning"),
    detail: String(raw.detail ?? raw.reason ?? "Inspect this anchored source issue."),
    severity: (["notice", "warning", "blocking"].includes(String(raw.severity))
      ? String(raw.severity)
      : "warning") as WizardSnapshot["warnings"][number]["severity"],
    occurrences: occurrences.map((row) => ({
      id: String(row.id ?? ""),
      source: String(row.source ?? row.text ?? ""),
      text: String(row.text ?? row.source ?? ""),
      page: Number(row.page ?? 0),
      contextBefore: row.contextBefore == null ? undefined : String(row.contextBefore),
      contextAfter: row.contextAfter == null ? undefined : String(row.contextAfter),
      reason: row.reason == null ? undefined : String(row.reason),
    })),
    availableActions: Array.isArray(raw.availableActions)
      ? raw.availableActions.map(String).filter((action) => action !== "defer") as WizardSnapshot["warnings"][number]["availableActions"]
      : ["keep"],
  };
}

function serializeDialogueSettings(settings: DialogueSettings, includeStrategy = true) {
  const payload = {
    customRegexes: settings.regexes.filter((row) => !row.builtIn).map((row) => ({
      id: row.id,
      label: row.label,
      pattern: row.pattern,
      priority: row.priority,
      enabled: row.enabled,
      flags: row.flags ?? "m",
    })),
    openSpeakerPatterns: settings.openSpeakerPatterns,
    attributionTargets: settings.attributionTargets,
    ...(settings.conflictResolutions?.length
      ? { conflictResolutions: settings.conflictResolutions }
      : {}),
    ...(settings.structuralResolutions?.length
      ? { structuralResolutions: settings.structuralResolutions }
      : {}),
    ...(includeStrategy ? { strategy: settings.strategy } : {}),
    ...(includeStrategy && settings.attributionRoute
      ? { attributionRoute: settings.attributionRoute }
      : {}),
  };
  return settings.regexes.length
    ? { ...payload, enabledRegexIds: settings.regexes.filter((row) => row.enabled).map((row) => row.id) }
    : payload;
}

export const wizardApi = new HttpWizardApi();
