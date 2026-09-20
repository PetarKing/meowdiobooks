/** In-memory preview operations. Nothing here parses files, calls a model, or writes media. */
import { targetChapterPartSeconds } from "../src/workflow/generation";
import type {
  LibraryExport,
  LocalBook,
  WorkflowGateway,
  WizardSnapshot,
} from "../src/api/contracts";
export function fixtureActions(
  snapshot: WizardSnapshot,
  books: LocalBook[],
  exports: LibraryExport[],
  readyScript: NonNullable<WizardSnapshot["recordingScript"]>,
  silentAudio: string,
): Pick<
  WorkflowGateway,
  | "importBook"
  | "acceptStage"
  | "prepareRecordingScript"
  | "splitRecordingScriptChapter"
  | "previewReviewBulk"
  | "transcribeVoiceSample"
  | "uploadVoiceSample"
  | "deleteVoiceAudition"
  | "cancelJob"
  | "openChapterAudio"
  | "createAudioExport"
  | "createM4bExport"
  | "exportM4b"
  | "openLibraryExport"
  | "revealLibraryExport"
> {
  const log = (action: string) => console.info(`[Simulated preview] ${action}`);
  const cast = () => {
    if (!snapshot.cast) throw new Error("Choose a synthetic cast first.");
    return snapshot.cast;
  };
  const exportAudio: NonNullable<WorkflowGateway["createAudioExport"]> = async (
    _book,
    chapters,
    options,
  ) => {
    const item: LibraryExport = {
      id: `simulated-export-${exports.length + 1}`,
      bookId: snapshot.book.id,
      title: options.title || snapshot.book.title,
      author: options.author || snapshot.book.author,
      filename: "simulated-audiobook.m4b",
      location: "Preview only — no file was created",
      chapterCount: chapters.length,
      chapterPositions: chapters.map(
        (c) => snapshot.chapters.findIndex((row) => row.id === c.chapterId) + 1,
      ),
      sizeBytes: 0,
      partial: chapters.length < snapshot.chapters.length,
      preset: options.preset,
      createdAt: "2026-09-13T12:00:00Z",
    };
    exports.push(item);
    log(
      "Added synthetic export metadata to the preview Library; no audiobook was encoded.",
    );
    return structuredClone(item);
  };
  return {
    importBook: async (file) => {
      const book = {
        id: snapshot.book.id,
        title: file.name.replace(/\.pdf$/i, ""),
        source_name: file.name,
        source_kind: "pdf",
        page_count: 120,
      };
      books.splice(0, books.length, book);
      snapshot.book = {
        ...snapshot.book,
        title: book.title,
        filename: file.name,
        completedStages: ["import"],
      };
      snapshot.activeArtifacts = {};
      snapshot.generatedChapters = [];
      delete snapshot.recordingScript;
      log(
        "Imported the sample fixture using the chosen filename; file contents were not parsed.",
      );
      return {
        book,
        representativePages: [
          {
            page: 1,
            reason: "Synthetic opening page",
          },
        ],
        duplicate: false,
      };
    },
    acceptStage: async (_book, stage, revision, decisions = []) => {
      const order = [
        "import",
        "extract",
        "dialogue",
        "review",
        "cast",
        "generate",
      ] as const;
      snapshot.book.completedStages = order.slice(0, order.indexOf(stage) + 1);
      const key = stage === "extract" ? "extraction" : stage;
      snapshot.activeArtifacts = {
        ...snapshot.activeArtifacts,
        [key]: revision,
      };
      if (stage === "cast") {
        const current = cast();
        current.phase = "accepted";
        current.revision = revision;
        for (const voice of [current.narrator, ...(current.identities ?? [])]) {
          if (!voice) continue;
          const decision = decisions.find(
            (d) => "characterId" in d && d.characterId === voice.characterId,
          );
          voice.voiceAccepted = true;
          voice.acceptedVoiceRevision =
            decision && "voiceRevision" in decision
              ? decision.voiceRevision
              : voice.voicePreviewRevision;
          if (decision && "voiceRoute" in decision)
            voice.voiceRoute = decision.voiceRoute;
        }
        snapshot.recordingScript = structuredClone(readyScript);
        snapshot.activeArtifacts.script = readyScript.revision;
      }
      if (stage === "dialogue") {
        delete snapshot.pendingCandidates?.dialogue;
        delete snapshot.dialogueRecovery;
      }
      log(`Accepted ${stage} in preview memory.`);
    },
    prepareRecordingScript: async () => {
      snapshot.recordingScript ??= structuredClone(readyScript);
      return structuredClone(snapshot.recordingScript);
    },
    splitRecordingScriptChapter: async (_book, chapterId) => {
      const chapter = snapshot.chapters.find((c) => c.id === chapterId);
      if (!chapter) throw new Error("Choose an available preview chapter.");
      const estimate =
        snapshot.recordingScript?.summary.chapters.find(
          (c) => c.chapterId === chapterId,
        )?.estimatedSeconds ?? 120;
      const count = Math.max(2, Math.ceil(estimate / targetChapterPartSeconds));
      const parts = Array.from({ length: count }, (_, i) => i + 1).map(
        (part) => ({
          ...chapter,
          id: `${chapterId}-part-${part}`,
          title: `${chapter.title} · Part ${part}`,
          splitFrom: chapterId,
          estimatedCharacters: Math.ceil(
            (chapter.estimatedCharacters ?? 1800) / count,
          ),
        }),
      );
      snapshot.chapters = snapshot.chapters.flatMap((c) =>
        c.id === chapterId ? parts : [c],
      );
      snapshot.generatedChapters = snapshot.generatedChapters.filter(
        (c) => c.chapterId !== chapterId,
      );
      snapshot.recordingScript = {
        ...structuredClone(snapshot.recordingScript ?? readyScript),
        chapters: snapshot.chapters,
      };
      snapshot.recordingScript.summary.chapters =
        snapshot.recordingScript.summary.chapters.flatMap((c) =>
          c.chapterId === chapterId
            ? parts.map((p) => ({
                ...c,
                chapterId: p.id,
                totalCharacters: p.estimatedCharacters,
                retainedCharacters: p.estimatedCharacters,
                estimatedSeconds: estimate / count,
              }))
            : [c],
        );
      log(`Split the synthetic chapter into ${count} sample parts.`);
      return structuredClone(snapshot.recordingScript);
    },
    previewReviewBulk: async () => ({
      count: snapshot.warnings.flatMap((w) => w.occurrences ?? []).length,
      affected: snapshot.warnings.flatMap((w) => w.occurrences ?? []),
    }),
    transcribeVoiceSample: async () => ({
      text: "Who in the world am I? Ah, that’s the great puzzle.",
      language: "English",
    }),
    uploadVoiceSample: async (
      _book,
      _revision,
      characterId,
      _file,
      referenceText,
    ) => {
      const current = cast();
      const voice = [current.narrator, ...(current.identities ?? [])].find(
        (v) => v?.characterId === characterId,
      );
      if (voice) {
        const revision = `${characterId}-sample-preview`;
        voice.voiceCandidates = [
          ...(voice.voiceCandidates ?? []),
          {
            revision,
            previewUrl: silentAudio,
            referenceText,
            direction: "Synthetic sample",
            source: "upload",
          },
        ];
        voice.voicePreviewRevision = revision;
      }
      log(
        "Added a silent synthetic sample audition; no cloning was performed.",
      );
      return structuredClone(current);
    },
    deleteVoiceAudition: async (_book, _revision, characterId, revision) => {
      const current = cast();
      const voice = [current.narrator, ...(current.identities ?? [])].find(
        (v) => v?.characterId === characterId,
      );
      if (voice)
        voice.voiceCandidates = voice.voiceCandidates?.filter(
          (v) => v.revision !== revision,
        );
      return structuredClone(current);
    },
    cancelJob: async (jobId) => ({
      id: jobId,
      kind: "preview",
      status: "canceled",
      progress: 0,
      message: "Simulated preview job cancelled",
    }),
    openChapterAudio: async () =>
      log(
        "Open audio requested. Use the inline silent sample player; no external file was opened.",
      ),
    createAudioExport: exportAudio,
    createM4bExport: async (book, chapters, options = {}) =>
      exportAudio(book, chapters, { ...options, preset: "m4b-high" }),
    exportM4b: async () => ({
      blob: new Blob(
        [JSON.stringify({ simulated: true, note: "No audio was encoded" })],
        { type: "application/json" },
      ),
      filename: "simulated-export-manifest.json",
    }),
    openLibraryExport: async () =>
      log(
        "Open export requested; this Library entry is synthetic metadata, with no file to launch.",
      ),
    revealLibraryExport: async () =>
      log(
        "Reveal export requested; preview exports have no filesystem location.",
      ),
  };
}
