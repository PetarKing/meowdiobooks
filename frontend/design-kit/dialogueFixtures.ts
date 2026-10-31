import type {
  DialogueArtifact,
  RawDialogueCandidate,
} from "../src/api/contracts";
import type { DialogueFixtureVariant } from "./scenarioRegistry";
export function dialogueFor(variant: DialogueFixtureVariant): DialogueArtifact {
  const examples = ["Alice", "White Rabbit", undefined].map((speaker, i) => ({
    spanId: `span-${i}`,
    page: i + 1,
    source: "“Who are you?”",
    spokenText: "Who are you?",
    speakerLabel: speaker,
    speakerStatus: speaker ? ("explicit" as const) : ("unresolved" as const),
    origin: "quotes",
    contextBefore: "The garden grew quiet.",
    contextAfter: "Nobody answered at first.",
  }));
  return {
    revision: "dialogue-fixture-1",
    scanVersion: 6,
    regexes: [
      {
        id: "quotes",
        label: "Curly quotes",
        pattern: "“(?<text>.+?)”",
        priority: 1,
        enabled: true,
        builtIn: true,
        matchCount: 3,
        examples,
      },
    ],
    openSpeakerPatterns: ["^\\?+$"],
    summary: {
      totalTurns: 3,
      explicitTurns: 2,
      openSpeakerTurns: 0,
      unlabeledCandidates: 1,
      conflicts: variant === "conflicts" ? 1 : 0,
      aiAttributed: 0,
      unresolved: 1,
    },
    examples,
    speakerOptions: ["Alice", "White Rabbit"],
    readerAssignments: [
      { label: "Alice", total: 1, known: 1, ai: 0, user: 0 },
      { label: "White Rabbit", total: 1, known: 1, ai: 0, user: 0 },
    ],
    conflicts:
      variant === "conflicts"
        ? [
            {
              id: "conflict-1",
              groupId: "group-1",
              profileIds: ["quotes", "speech"],
              page: 2,
              claims: [
                {
                  matchId: "m1",
                  profileId: "quotes",
                  page: 2,
                  source: "Alice: “Wait!”",
                  spokenText: "Wait!",
                },
                {
                  matchId: "m2",
                  profileId: "speech",
                  page: 2,
                  source: "Alice: “Wait!”",
                  spokenText: "Wait!",
                  speakerLabel: "Alice",
                },
              ],
            },
          ]
        : [],
    routing: {
      targetCount: 1,
      largeReviewThreshold: 100,
      shouldPrompt: false,
      defaultRoute: "local",
      local: { displayName: "Qwen", apiCostUsd: 0 },
    },
  };
}

export function dialogueCandidate(): RawDialogueCandidate {
  return {
    revision: "dialogue-fixture-draft",
    strategy: "fill-gaps",
    attributionTargets: ["unlabelled-candidates"],
    resultSummary: {
      explicitTurns: 2,
      aiAttributed: 1,
      unresolved: 1,
      aiSuggestedForReview: 1,
    },
    spans: [
      {
        id: "known-1",
        page: 1,
        source: "Alice: “Who are you?”",
        text: "Who are you?",
        renderRole: "dialogue",
        sourceSpeakerLabel: "Alice",
        resolvedSpeakerLabel: "Alice",
        speakerStatus: "explicit",
        origin: "regex:label-brackets",
      },
      {
        id: "known-2",
        page: 1,
        source: "White Rabbit: “I am late!”",
        text: "I am late!",
        renderRole: "dialogue",
        sourceSpeakerLabel: "White Rabbit",
        resolvedSpeakerLabel: "White Rabbit",
        speakerStatus: "explicit",
        origin: "regex:label-brackets",
      },
      {
        id: "ai-1",
        page: 2,
        source: "“Certainly.”",
        text: "Certainly.",
        renderRole: "dialogue",
        resolvedSpeakerLabel: "Alice",
        speakerStatus: "ai",
        origin: "qwen:targeted-speaker-v2",
      },
      {
        id: "uncertain-1",
        page: 8,
        source: "“We should go.”",
        text: "We should go.",
        renderRole: "dialogue",
        speakerStatus: "unresolved",
        origin: "qwen:targeted-speaker-v2",
      },
    ],
    aiWindows: [
      {
        id: "w0",
        ownerIds: ["ai-1"],
        dossiers: [
          {
            page: 2,
            before: "Alice nodded.",
            target: "“Certainly.”",
            after: "She closed the door.",
          },
        ],
      },
      {
        id: "w1",
        ownerIds: ["uncertain-1"],
        dossiers: [
          {
            page: 8,
            before: "They reached the garden.",
            target: "“We should go.”",
            after: "The gate was open.",
          },
        ],
      },
    ],
    attributionChecks: [
      {
        spanId: "ai-1",
        firstPass: "Alice",
        secondPass: "Alice",
        final: "Alice",
        outcome: "agreed",
        suggestedSpeakers: [],
      },
      {
        spanId: "uncertain-1",
        firstPass: "Alice",
        secondPass: "White Rabbit",
        final: "?",
        outcome: "withheld",
        suggestedSpeakers: ["Alice", "White Rabbit"],
      },
    ],
  };
}
