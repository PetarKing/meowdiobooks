/** In-memory gateway for interactive Storybook review; no provider or filesystem operations. */
import type {
  CastArtifact,
  CastProcessSettings,
  LibraryExport,
  StageCandidate,
  WorkflowGateway,
} from "../src/api/contracts";
import { metadataFor, type ScenarioId } from "./scenarioRegistry";
import { fixtureActions } from "./fixtureActions";
import { snapshotFor } from "./snapshotFixture";
import {
  fixtureBook,
  sourceImage,
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
  const snapshot = snapshotFor(id);
  let libraryRequests = 0;
  const books = gatewayVariant === "empty-books" ? [] : gatewayVariant === "home-shelf" ? [
    fixtureBook,
    { ...fixtureBook, id: "kit-book-2", title: "The Moonlit Temple", source_name: "moonlit-temple.pdf", page_count: 296, asset_size_bytes: 11_800_000 },
    { ...fixtureBook, id: "kit-book-3", title: "The Little Prince", source_name: "little-prince.pdf", page_count: 96, asset_size_bytes: 3_800_000 },
    { ...fixtureBook, id: "kit-book-4", title: "A Very Long Book Title That Takes More Than One Line", source_name: "long-title.pdf", page_count: 433, asset_size_bytes: 18_400_000 },
    { ...fixtureBook, id: "kit-book-5", title: "夜の猫", source_name: "night-cat.pdf", page_count: 184, asset_size_bytes: 6_100_000 },
    { ...fixtureBook, id: "kit-book-6", title: "The Secret Garden", source_name: "secret-garden.pdf", page_count: 256, asset_size_bytes: 8_400_000 },
  ] : [fixtureBook];
  const canceledJobs = new Set<string>();
  let castCandidate: CastArtifact | undefined;
  const exports = [
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
    sourcePageImageUrl: () => sourceImage,
    layeredVoicePreviewUrl: () => silentWav,
    libraryCoverImageUrl: () =>
      gatewayVariant === "library-missing-cover"
        ? "data:image/png;base64,broken"
        : libraryCoverImage,
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
          const voice = [
            snapshot.cast?.narrator,
            ...(snapshot.cast?.identities ?? []),
          ].find((row) => row?.characterId === voiceSettings.characterId);
          if (voice) {
            const revision = `${voice.characterId}-preview-${(voice.voiceCandidates?.length ?? 0) + 1}`;
            voice.voiceCandidates = [
              ...(voice.voiceCandidates ?? []),
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
            voice.voiceSettings =
              voiceSettings.voiceSettings ?? voice.voiceSettings;
          }
          castCandidate = {
            ...structuredClone(snapshot.cast!),
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
            : "Checking dialogue speakers",
        error:
          gatewayVariant === "generate-failed"
            ? "Chapter generation stopped before Chapter 4. The first three chapters are still saved."
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
        message: jobId.includes("generate")
          ? "Generating chapter 4 of 6"
          : "Checking dialogue speakers",
      };
    },
    getStageCandidate: async (_book, stage, revision) => {
      const candidate =
        stage === "review"
          ? {
              revision,
              warnings: snapshot.warnings,
              boundaryCandidates: snapshot.boundaryCandidates,
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
      if (!selectedBook || gatewayVariant !== "home-shelf") return structuredClone(snapshot);
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
      imageUrl: sourceImage,
    }),
    previewDialogue: async () => structuredClone(snapshot.dialogue!),
    previewReviewTranscript: async (_book, _revision, page) => ({
      page,
      pageCount: 120,
      imageUrl: sourceImage,
      published: false,
      summary: { spoken: 2, dialogue: 1, excluded: 0 },
      spans: [
        {
          id: "n1",
          kind: "narration",
          reader: "Narrator",
          text: "Alice was beginning to get very tired of sitting by her sister on the bank.",
          blockId: "p1",
          sourceStart: 0,
          sourceEnd: 75,
        },
        {
          id: "d1",
          kind: "dialogue",
          reader: "Alice",
          text: "What is the use of a book without pictures or conversations?",
          blockId: "p1",
          sourceStart: 76,
          sourceEnd: 134,
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
