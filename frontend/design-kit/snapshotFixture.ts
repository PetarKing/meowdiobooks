import type { WizardSnapshot } from "../src/api/contracts";
import { metadataFor, type ScenarioId } from "./scenarioRegistry";
import { fixtureBook, silentWav, text } from "./syntheticContent";
import { castFor } from "./castFixtures";
import { dialogueFor } from "./dialogueFixtures";
export function snapshotFor(id: ScenarioId): WizardSnapshot {
  const metadata = metadataFor(id);
  const completed: WizardSnapshot["book"]["completedStages"] = [
    ...metadata.completedStages,
  ];
  const longExport = metadata.snapshotVariant === "export-long-book";
  const chapterTitles = longExport
    ? Array.from({ length: 20 }, (_, i) => `Synthetic review chapter ${i + 1}`)
    : [
        "Down the Rabbit-Hole",
        "The Pool of Tears",
        "A Caucus-Race and a Long Tale",
        "The Rabbit Sends in a Little Bill",
        "Advice from a Caterpillar",
        "Pig and Pepper",
      ];
  const pagesPerChapter = longExport ? 6 : 20;
  const chapters = chapterTitles.map((title, i) => ({
    id: `chapter-${i + 1}`,
    title,
    startPage: 1 + i * pagesPerChapter,
    endPage: (i + 1) * pagesPerChapter,
    estimatedCharacters: longExport
      ? (780 + (i % 7) * 130) * 15
      : 1800 + i * 100,
  }));
  const totalCharacters = longExport
    ? chapters.reduce((sum, chapter) => sum + chapter.estimatedCharacters, 0)
    : 12300;
  const snapshot: WizardSnapshot = {
    book: {
      id: fixtureBook.id,
      title: fixtureBook.title,
      author: "Lewis Carroll",
      filename: "alice.pdf",
      pageCount: 120,
      completedStages: completed,
    },
    activeArtifacts: {
      ...(completed.includes("extract")
        ? { extraction: "extraction-fixture-1" }
        : {}),
      ...(completed.includes("dialogue")
        ? { dialogue: "dialogue-fixture-1" }
        : {}),
      ...(completed.includes("review") ? { review: "review-fixture-1" } : {}),
      ...(completed.includes("cast")
        ? { cast: "cast-fixture-1", script: "script-fixture-1" }
        : {}),
    },
    ...(metadata.snapshotVariant === "dialogue-results"
      ? {
          pendingCandidates: {
            dialogue: {
              revision: "dialogue-fixture-draft",
              status: "candidate" as const,
            },
          },
        }
      : {}),
    dialogue: dialogueFor(metadata.dialogueFixture),
    cast: castFor(metadata.castFixture),
    warnings:
      metadata.snapshotVariant === "review-warnings"
        ? [
            {
              id: "repeated",
              kind: "repeated-matter",
              detail: "Repeated page header may interrupt narration.",
              severity: "warning",
              readerState: "narrator",
              availableActions: ["keep", "exclude"],
              occurrences: Array.from({ length: 8 }, (_, i) => ({
                id: `header-${i}`,
                source: "ALICE IN WONDERLAND",
                text: "ALICE IN WONDERLAND",
                page: i + 1,
                contextBefore: "The previous paragraph ends here.",
                contextAfter: text,
              })),
            },
            {
              id: "speaker",
              kind: "unresolved-speaker",
              detail: "No confirmed speaker; these lines use Narrator.",
              severity: "notice",
              readerState: "narrator",
              availableActions: ["keep", "narrate"],
              occurrences: [
                {
                  id: "unresolved-1",
                  source: "“Who are you?”",
                  text: "Who are you?",
                  page: 8,
                },
              ],
            },
          ]
        : [],
    boundaryCandidates:
      metadata.snapshotVariant === "review-boundaries"
        ? chapters.map((c) => ({
            id: `boundary-${c.id}`,
            source: c.title,
            page: c.startPage,
            reason: "Standalone heading in the source.",
          }))
        : [],
    reviewInspection: {
      decisions: [],
      boundaryDecisions: [],
      consequences: {},
      history: [],
    },
    ...(metadata.snapshotVariant === "review-recovery"
      ? {
          dialogueRecovery: {
            kind: "malformed-playable-span" as const,
            spanIds: ["span-2"],
            page: 3,
            availableActions: ["rerun-dialogue"] as ["rerun-dialogue"],
          },
        }
      : {}),
    voiceModels: [
      {
        id: "qwen",
        label: "Qwen",
        supportedLanguages: [
          "english",
          "chinese",
          "german",
          "italian",
          "portuguese",
          "spanish",
          "japanese",
          "korean",
          "french",
          "russian",
        ],
      },
    ],
    voiceSelection: { modelId: "qwen", language: "english" },
    castingPreviewAvailable: metadata.castingPreviewAvailable,
    recordingScript: {
      revision: "script-fixture-1",
      status: "ready",
      sourceCoverage: { status: "exact" },
      entries: chapters.map((c) => ({ chapterId: c.id })),
      summary: {
        totalSpans: 100,
        retainedSpans: 100,
        omittedSpans: 0,
        dialogueSpans: 30,
        narratorFallbackSpans: 1,
        totalCharacters,
        retainedCharacters: totalCharacters,
        omittedCharacters: 0,
        estimatedSeconds: totalCharacters / 15,
        emptyChapterIds: [],
        estimationMethod: "15-render-characters-per-second",
        chapters: chapters.map((c) => ({
          chapterId: c.id,
          totalCharacters: c.estimatedCharacters,
          retainedCharacters: c.estimatedCharacters,
          dialogueSpans: 5,
          narratorFallbackSpans: 0,
          estimatedSeconds: c.estimatedCharacters / 15,
          empty: false,
        })),
      },
    },
    chapters,
    generatedChapters: (completed.includes("cast")
      ? longExport
        ? chapters
        : chapters.slice(0, 3)
      : []
    ).map((c, i) => ({
      chapterId: c.id,
      revision: `audio-${i}`,
      audioUrl: silentWav,
      audioSeconds: longExport ? 780 + (i % 7) * 130 : 120 + i * 10,
      current: true,
      staleReasons: [],
    })),
    history: {},
  };
  if (completed.includes("cast") && snapshot.cast) {
    snapshot.cast.phase = "accepted";
    for (const current of [
      snapshot.cast.narrator,
      ...(snapshot.cast.identities ?? []),
    ])
      if (current) {
        current.voiceAccepted = true;
        current.acceptedVoiceRevision = current.voicePreviewRevision;
      }
  }
  if (!completed.includes("cast")) delete snapshot.recordingScript;
  if (metadata.snapshotVariant === "generate-stale") {
    snapshot.generatedChapters[0].current = false;
    snapshot.generatedChapters[0].staleReasons = ["cast-revision-changed"];
    snapshot.recordingScript!.summary.emptyChapterIds = ["chapter-6"];
    snapshot.recordingScript!.summary.chapters[5].empty = true;
  }
  if (metadata.snapshotVariant === "generate-split") {
    snapshot.chapters = snapshot.chapters.slice(0, 1);
    snapshot.generatedChapters = [];
    snapshot.chapters[0].estimatedCharacters = 135000;
    snapshot.recordingScript!.entries = [{ chapterId: "chapter-1" }];
    snapshot.recordingScript!.summary.chapters = [
      {
        chapterId: "chapter-1",
        totalCharacters: 135000,
        retainedCharacters: 135000,
        dialogueSpans: 30,
        narratorFallbackSpans: 1,
        estimatedSeconds: 9000,
        empty: false,
      },
    ];
    snapshot.recordingScript!.summary.totalCharacters = 135000;
    snapshot.recordingScript!.summary.retainedCharacters = 135000;
    snapshot.recordingScript!.summary.estimatedSeconds = 9000;
  }
  if (
    metadata.snapshotVariant === "dialogue-routing" ||
    metadata.snapshotVariant === "dialogue-routing-unconfigured"
  )
    snapshot.dialogue!.routing = {
      targetCount: 140,
      largeReviewThreshold: 100,
      shouldPrompt: true,
      defaultRoute:
        metadata.snapshotVariant === "dialogue-routing" ? "local" : "remote",
      local: { displayName: "Qwen", apiCostUsd: 0 },
      remote: {
        displayName: "Luna",
        domain: "api.openai.com",
        credentialConfigured: metadata.snapshotVariant === "dialogue-routing",
        apiKeyEnvironmentVariable: "OPENAI_API_KEY",
        estimatedCostUsd: 0.35,
        falseNamesReductionPercent: 85,
        speakerRecallImprovementPercent: 272,
      },
    };
  if (metadata.snapshotVariant === "dialogue-structural") {
    const claim = {
      matchId: "turn-1",
      profileId: "quotes",
      page: 2,
      source: "Alice: “Wait! White Rabbit: Hurry!”",
      spokenText: "Wait! White Rabbit: Hurry!",
      speakerLabel: "Alice",
    };
    snapshot.dialogue!.structuralIssues = [
      {
        id: "interrupted-1",
        kind: "interrupted-turn",
        profileId: "quotes",
        page: 2,
        source: claim.source,
        outerSpeakerLabel: "Alice",
        innerSpeakerLabels: ["White Rabbit"],
        availableActions: ["split", "keep-together", "narration"],
        interpretations: {
          split: [
            { ...claim, spokenText: "Wait!" },
            {
              ...claim,
              matchId: "turn-2",
              spokenText: "Hurry!",
              speakerLabel: "White Rabbit",
            },
          ],
          "keep-together": [claim],
          narration: [claim],
        },
      },
    ];
    snapshot.dialogue!.summary.structuralIssues = 1;
  }
  return snapshot;
}
