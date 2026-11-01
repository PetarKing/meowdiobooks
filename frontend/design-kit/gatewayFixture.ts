/** In-memory gateway for interactive Storybook review; no provider or filesystem operations. */
import type {
  CastArtifact,
  CastProcessSettings,
  LibraryExport,
  LocalBook,
  StageCandidate,
  WorkflowGateway,
} from "../src/api/contracts";
import { metadataFor, type ScenarioId } from "./scenarioRegistry";
import { fixtureActions } from "./fixtureActions";
import { snapshotFor } from "./snapshotFixture";
import {
  fixtureBook,
  sourceImage,
  sourcePageHeading,
  sourcePageNarration,
  sourcePageThought,
  libraryCoverImage,
  silentWav,
  text,
} from "./syntheticContent";
import { dialogueCandidate } from "./dialogueFixtures";
const library: LibraryExport[] = [false, true].map((partial, i) => ({
  id: `fixture-export-${i}`,
  bookId: fixtureBook.id,
  title: `${fixtureBook.title}${partial ? " — Selected chapters" : ""}`,
  author: "Lewis Carroll",
  filename: `Alice${partial ? "-selected" : ""}.m4b`,
  location: "/fixture-library/Alice.m4b",
  chapterCount: partial ? 3 : 6,
  chapterPositions: partial ? [1, 2, 5] : [1, 2, 3, 4, 5, 6],
  sizeBytes: 12 * 1024 * 1024,
  partial,
  preset: "m4b-high",
  createdAt: "2026-09-13T12:00:00Z",
}));
export function createFixtureGateway(id: ScenarioId): WorkflowGateway {
  const metadata = metadataFor(id);
  const { gatewayVariant } = metadata;
  const sourcePagePreview = (page: number) => metadata.snapshotVariant === "review-missing-pages"
    ? sourceImage.replace(encodeURIComponent("PREVIEW · 1"), encodeURIComponent(`PREVIEW · ${page}`)) : sourceImage;
  const snapshot = snapshotFor(id);
  if (id === "export-default-cover") snapshot.book.sourceKind = "text";
  if (gatewayVariant === "dialogue-running" && snapshot.dialogue) {
    snapshot.dialogue.routing = {
      targetCount: 1600, largeReviewThreshold: 100, shouldPrompt: false, defaultRoute: "remote",
      local: { displayName: "Local", apiCostUsd: 0 },
      remote: { displayName: "Remote", domain: "api.example.invalid", credentialConfigured: true,
        apiKeyEnvironmentVariable: "SYNTHETIC_KEY", estimatedCostUsd: 0, estimatedDurationSeconds: 600 },
    };
  }
  let libraryRequests = 0;
  const shelf: LocalBook[] = [
    fixtureBook,
    { ...fixtureBook, id: "kit-book-2", title: "The Moonlit Temple", source_name: "moonlit-temple.pdf", page_count: 296, asset_size_bytes: 11_800_000 },
    { ...fixtureBook, id: "kit-book-3", title: "The Little Prince", source_name: "little-prince.pdf", page_count: 96, asset_size_bytes: 3_800_000 },
    { ...fixtureBook, id: "kit-book-4", title: "A Very Long Book Title That Takes More Than One Line", source_name: "long-title.pdf", page_count: 433, asset_size_bytes: 18_400_000 },
    { ...fixtureBook, id: "kit-book-5", title: "夜の猫", source_name: "night-cat.pdf", page_count: 184, asset_size_bytes: 6_100_000 },
    { ...fixtureBook, id: "kit-book-6", title: "The Secret Garden", source_name: "secret-garden.pdf", page_count: 256, asset_size_bytes: 8_400_000 },
  ];
  const collectionSize = gatewayVariant === "collection-empty" ? 0 : gatewayVariant === "collection-few" ? 2 : gatewayVariant === "collection-many" ? 12 : undefined;
  const collectionBooks = [...shelf, ...[
    "A Small Atlas of Rain", "Letters from the Floating City", "The House at the Edge of the Sea",
    "Quiet Mornings", "星を読む猫", "A Field Guide to Impossible Things",
  ].map((title, i) => ({ ...fixtureBook, id: `kit-book-${i + 7}`, title, source_name: `book-${i + 7}.pdf`, page_count: 140 + i * 37, asset_size_bytes: 4_000_000 + i * 750_000 }))];
  const books = collectionSize !== undefined ? collectionBooks.slice(0, collectionSize) : gatewayVariant === "empty-books" ? [] : gatewayVariant === "home-shelf" ? shelf : [fixtureBook];
  const canceledJobs = new Set<string>();
  let castCandidate: CastArtifact | undefined;
  let auditionSequence = 0;
  let ocrOutcome: import("../src/api/contracts").OcrRecoveryResult | undefined;
  const exports = collectionSize !== undefined ? collectionBooks.slice(0, collectionSize).map((book, i): LibraryExport => ({
    ...library[i % library.length], id: `collection-export-${i}`, bookId: book.id, title: book.title,
    author: ["Lewis Carroll", "Hana Mori", "Antoine de Saint-Exupéry", "M. A. Rivers", "夏野 みどり", "Frances Hodgson Burnett"][i % 6],
    sizeBytes: (12 + i * 3) * 1024 * 1024,
  })) : [
    "library-populated",
    "library-missing-cover",
    "library-refresh-error",
  ].includes(gatewayVariant)
    ? structuredClone(library)
    : [];
  const actions = fixtureActions(
    snapshot,
    books,
    exports,
    snapshotFor("generate").recordingScript!,
    silentWav,
  );
  const implemented: WorkflowGateway = {
    ...actions,
    sourcePageImageUrl: () => id === "export-default-cover" ? "/default-cover.svg" : sourceImage,
    layeredVoicePreviewUrl: () => silentWav,
    libraryCoverImageUrl: (itemId) =>
      gatewayVariant === "library-missing-cover"
        ? "data:image/png;base64,broken"
        : collectionSize !== undefined ? libraryCoverImage.replaceAll("214b52", ["214b52", "4c4730", "53415b", "30534b", "5a3948", "3e475c"][Math.max(0, exports.findIndex(item => item.id === itemId)) % 6]) : libraryCoverImage,
    ...(gatewayVariant === "sample-upload-pending"
      ? {
          transcribeVoiceSample: async () => ({
            text: "Who in the world am I? Ah, that’s the great puzzle.",
            language: "English",
          }),
          uploadVoiceSample: async () => new Promise<CastArtifact>(() => {}),
        }
      : {}),
    listBooks: async () => structuredClone(books),
    deleteBook: async (bookId) => {
      const index = books.findIndex((book) => book.id === bookId);
      if (index >= 0) books.splice(index, 1);
    },
    listBookJobs: async () => [],
    processStage: async (_book, stage, settings) => {
      if (stage === "cast") {
        const voiceSettings = settings as CastProcessSettings;
        if (voiceSettings.forceReclassify) {
          castCandidate = {
            ...structuredClone(snapshot.cast!),
            revision: "cast-fixture-draft",
            phase: "identity-review",
            identityDecisions: undefined,
            narrator: undefined,
            identities: undefined,
            reusedFromRevision: undefined,
          };
        } else {
          const draft = structuredClone(castCandidate ?? snapshot.cast!);
          const voice = [
            draft.narrator,
            ...(draft.identities ?? []),
          ].find((row) => row?.characterId === voiceSettings.characterId);
          if (voice) {
            const revision = `${voice.characterId}-new-audition-${++auditionSequence}`;
            // New auditions extend the editable collection in creation order.
            // The accepted snapshot and other cast voices remain unchanged.
            const candidates = voice.voiceCandidates?.length ? voice.voiceCandidates : voice.voicePreviewRevision ? [{
              revision: voice.voicePreviewRevision,
              previewUrl: voice.previewUrl ?? "",
              referenceText: voice.referenceText,
              direction: voice.voiceDirection ?? "",
              voiceSettings: voice.voiceSettings,
            }] : [];
            voice.voiceCandidates = [
              ...candidates,
              {
                revision,
                previewUrl: silentWav,
                referenceText: voice.referenceText ?? "Synthetic audition line.",
                direction: voiceSettings.sourceVoice
                  ? "Synthetic reused voice"
                  : (voiceSettings.voiceSettings?.description ??
                    "Synthetic new audition"),
                voiceSettings: voiceSettings.voiceSettings ?? voice.voiceSettings,
              },
            ];
            voice.voicePreviewRevision = revision;
            voice.voiceAccepted = false;
            voice.acceptedVoiceRevision = undefined;
            voice.voiceSettings =
              voiceSettings.voiceSettings ?? voice.voiceSettings;
          }
          castCandidate = {
            ...draft,
            revision: "cast-fixture-draft",
            phase: "audition-review",
          };
        }
      }
      if (
        stage === "generate" &&
        !["generate-running", "generate-failed"].includes(gatewayVariant)
      ) {
        const selected = (
          settings as import("../src/api/contracts").GenerationProcessSettings
        ).chapterIds;
        snapshot.generatedChapters = [
          ...snapshot.generatedChapters.filter(
            (c) => !selected.includes(c.chapterId),
          ),
          ...selected.map((chapterId) => ({
            chapterId,
            revision: `${chapterId}-simulated`,
            audioUrl: silentWav,
            audioSeconds: 120,
            current: true,
            staleReasons: [],
          })),
        ];
      }
      if (stage === "review" && "ocrPages" in settings && Array.isArray(settings.ocrPages)) {
        const pages = settings.ocrPages as number[];
        ocrOutcome = { requestedPages: [...pages], recoveredPages: [...pages], emptyPages: [], unchangedPages: [] };
        snapshot.activeArtifacts.extraction = "extraction-ocr";
        snapshot.activeArtifacts.dialogue = "dialogue-ocr";
        snapshot.warnings = snapshot.warnings.map((row) => ({ ...row,
          occurrences: row.occurrences.filter((occurrence) => !pages.includes(occurrence.page)),
        })).filter((row) => row.occurrences.length > 0);
      }
      return {
        id: `fixture-job-${stage}`,
        kind: `v2:${stage}`,
        status: [
          "generate-running",
          "dialogue-running",
        ].includes(gatewayVariant)
          ? "running"
          : gatewayVariant === "generate-failed"
            ? "failed"
            : "succeeded",
        progress: 36,
        message:
          stage === "generate"
            ? "Generating chapter 4 of 6"
            : "Checked 500 of 1600 independent speaker checks",
        error:
          gatewayVariant === "generate-failed"
            ? "We couldn’t create the audio. Please try again. Reference: 0123456789abcdef0123456789abcdef."
            : undefined,
        result: { revision: `${stage}-fixture-draft` },
      };
    },
    cancelJob: async (jobId) => {
      canceledJobs.add(jobId);
      return {
        id: jobId,
        kind: "preview",
        status: "canceled",
        message: "Simulated job canceled",
      };
    },
    getJob: async (jobId) => {
      return {
        id: jobId,
        kind: jobId.includes("generate") ? "v2:generate" : "v2:dialogue",
        status: canceledJobs.has(jobId) ? "canceled" : "running",
        progress: 36,
        started_at: new Date(Date.now() - 120_000).toISOString(),
        message: jobId.includes("generate")
          ? "Generating chapter 4 of 6"
          : "Checked 500 of 1600 independent speaker checks",
      };
    },
    getStageCandidate: async (_book, stage, revision) => {
      const candidate =
        stage === "review"
          ? {
              revision,
              warnings: snapshot.warnings,
              boundaryCandidates: snapshot.boundaryCandidates,
              ...(ocrOutcome ? { ocrRecovery: ocrOutcome } : {}),
              ...(metadata.snapshotVariant === "review-recovery"
                ? {
                    recovery: {
                      message:
                        "Rebuild Dialogue before continuing. The playable spans do not cover the source exactly.",
                    },
                  }
                : {}),
            }
          : stage === "dialogue"
            ? dialogueCandidate()
            : stage === "cast"
              ? castCandidate ?? { ...snapshot.cast!, revision, phase: "audition-review" as const }
              : { revision };
      return candidate as StageCandidate[typeof stage];
    },
    getBookSnapshot: async (bookId) => {
      if (gatewayVariant === "home-error")
        throw new Error("This book could not be opened. Try again.");
      const selectedBook = books.find((book) => book.id === bookId);
      if (!selectedBook || (gatewayVariant !== "home-shelf" && collectionSize === undefined)) return structuredClone(snapshot);
      return { ...structuredClone(snapshot), book: { ...snapshot.book, id: selectedBook.id, title: selectedBook.title, filename: selectedBook.source_name ?? snapshot.book.filename } };
    },
    getRepresentativePages: async () => [
      { page: 1, reason: "Opening page", },
      {
        page: 24,
        reason: "Dialogue-heavy page",
      },
      { page: 76, reason: "Mixed layout", },
    ],
    previewExtraction: async (_book, page, method) => ({
      page,
      method,
      pageCount: 120,
      text,
      warnings: [
        {
          code: "reading-order",
          label: "Check the reading order against the page.",
        },
      ],
      elapsedSeconds: 0.24,
      cached: true,
      imageUrl: sourcePagePreview(page),
    }),
    previewDialogue: async () => structuredClone(snapshot.dialogue!),
    previewReviewTranscript: async (_book, _revision, page) => ({
      page,
      pageCount: 120,
      imageUrl: sourcePagePreview(page),
      published: false,
      summary: { spoken: 3, dialogue: 1, excluded: 0 },
      spans: [
        {
          id: "heading", kind: "narration", reader: "Narrator", text: sourcePageHeading,
          blockId: "heading", sourceStart: 0, sourceEnd: sourcePageHeading.length,
        },
        {
          id: "n1",
          kind: "narration",
          reader: "Narrator",
          text: sourcePageNarration,
          blockId: "p1",
          sourceStart: 0,
          sourceEnd: sourcePageNarration.length,
        },
        {
          id: "d1",
          kind: "dialogue",
          reader: "Alice",
          text: sourcePageThought,
          blockId: "p2",
          sourceStart: 0,
          sourceEnd: sourcePageThought.length,
        },
      ],
    }),
    previewCasting: async (_book, settings) => ({
      fingerprint: "fixture-quote",
      sources: [
        {
          bookId: "previous-book",
          title: "Through the Looking-Glass",
          voiceCount: 3,
          voices: [
            {
              characterId: "alice",
              name: "Alice",
              revision: "previous-voice-1",
            },
          ],
        },
      ],
      exactMatchCount: settings.sourceBookIds?.length ? 1 : 0,
      totalVoiceCount: 7,
      remainingVoiceCount: settings.sourceBookIds?.length ? 6 : 7,
      currency: "USD",
      options: [
        {
          modelId: "qwen",
          label: "Qwen",
          description: "Generate new auditions for your cast.",
          estimatedCostMinor: 0,
        },
      ],
    }),
    listLibrary: async () => {
      libraryRequests += 1;
      if (gatewayVariant === "library-loading") return new Promise(() => {});
      if (gatewayVariant === "library-error")
        throw new Error("Library could not be loaded. Try again.");
      if (gatewayVariant === "library-refresh-error" && libraryRequests === 2)
        throw new Error("Library could not be loaded. Try again.");
      return structuredClone(exports);
    },
  };
  return implemented;
}
