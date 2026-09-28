import type {
  CastArtifact,
  CastVoice,
  VoiceSettings,
} from "../src/api/contracts";
import type { CastFixtureVariant } from "./scenarioRegistry";
import { silentWav } from "./syntheticContent";
function voice(name: string, index: number): CastVoice {
  const id = index < 0 ? "narrator" : `character-${index}`;
  const settings: VoiceSettings = {
    presentation: "androgynous",
    age: "adult",
    tone: "neutral",
    pitch: "medium",
    pace: "natural",
    energy: "balanced",
    accent: "unspecified",
    description: "Clear natural narration.",
  };
  const candidates = [1, 2, 3].map((attempt) => ({
    revision: `${id}-attempt-${attempt}`,
    previewUrl: silentWav,
    previewText: "What is the use of a book without pictures or conversations?",
    referenceText:
      "What is the use of a book without pictures or conversations?",
    voiceSettings: settings,
    direction: "Clear natural narration.",
    source: "generated" as const,
    durationSeconds: 0,
  }));
  return {
    characterId: id,
    name,
    category: "character",
    literalLabels: [name],
    lineCount: index < 0 ? 820 : 150 - (index % 80),
    referenceText: candidates[0].referenceText,
    voiceSettings: settings,
    auditionLine: candidates[0].previewText,
    voiceDirection: "Clear natural narration.",
    voiceCandidates: candidates,
    voicePreviewRevision: candidates[2].revision,
    previewUrl: silentWav,
    voiceAccepted: index % 3 === 0,
    ...(index % 3 === 0
      ? { acceptedVoiceRevision: candidates[1].revision }
      : {}),
  };
}
export function castFor(variant: CastFixtureVariant): CastArtifact {
  const dense = variant === "dense-identities" || variant === "dense-voices";
  const names = [
    "Alice",
    "White Rabbit",
    "Queen of Hearts",
    "The Hatter",
    "Cheshire Cat",
    "Dormouse",
  ];
  const identities = Array.from({ length: dense ? 60 : 6 }, (_, i) =>
    voice(
      i < names.length
        ? names[i]
        : `Court witness ${i + 1}${i % 9 === 0 ? " — keeper of the very long royal register" : ""}`,
      i,
    ),
  );
  if (dense) {
    identities[identities.length - 1] = {
      ...voice("Alice & White Rabbit", 100), category: "group",
      literalLabels: ["Alice & White Rabbit"], voiceAccepted: false,
      acceptedVoiceRevision: undefined,
    };
    identities[0].literalLabels = ["Alice", "A. Liddell"];
  }
  if (variant === "layered" || variant === "layered-confirmed")
    identities.push({
      ...voice("Alice & White Rabbit", 100),
      category: "group",
      literalLabels: ["Alice & White Rabbit"],
      voiceAccepted: false,
      acceptedVoiceRevision: undefined,
      ...(variant === "layered-confirmed"
        ? {
            voiceRoute: {
              kind: "layered" as const,
              characterIds: ["character-0", "character-1"],
            },
          }
        : {}),
    });
  if (variant === "identity-inspector")
    identities.push({
      ...voice("Alice & White Rabbit", 100),
      category: "group",
      literalLabels: ["Alice & White Rabbit"],
    });
  if (variant === "missing-audition")
    identities[0] = {
      characterId: "character-0",
      name: "Alice",
      category: "character",
      literalLabels: ["Alice"],
      lineCount: 150,
      voiceCandidates: [],
    };
  const identity = [
    "identity-review",
    "identity-inspector",
    "dense-identities",
    "voice-design",
  ].includes(variant);
  return {
    revision: "cast-fixture-1",
    phase: identity ? "identity-review" : "audition-review",
    voiceModel: "qwen",
    language: "english",
    detectedLanguage: "english",
    narrator: voice("Narrator", -1),
    identities,
    dossiers: [...identities.map((v, i) => ({
      label: v.name,
      occurrenceCount: v.lineCount,
      firstAppearance: i + 2,
      examples: [
        {
          source: `${v.name}: “Who are you?”`,
          page: i + 2,
          contextBefore: "The garden grew quiet.",
        },
      ],
      fuzzyCandidates: i === 2 && variant === "identity-review" ? ["Queen"] : [],
    })), ...(variant === "identity-review" ? [{
      label: "Queen",
      occurrenceCount: 4,
      firstAppearance: 11,
      examples: [{ source: "Queen: ‘Sentence first—verdict afterwards.’", page: 11, contextBefore: "The court fell silent." }],
      fuzzyCandidates: ["Queen of Hearts"],
    }] : [])],
    proposals: [...identities.map((v, i) => ({
      label: v.name,
      category: v.category ?? "character",
      canonicalName: dense && i === 2 ? "The Queen" : v.name,
      aliases: [],
      reviewRequired:
        variant !== "voice-design" &&
        (v.category === "group" || i === 2 || (dense && i % 11 === 0)),
      reason:
        i === 2
          ? variant === "identity-review"
            ? "The shorter Queen label may refer to this character. Compare the lines before attaching it."
            : "The literal label could refer to two different characters. Confirm the identity using the source evidence."
          : undefined,
      competingCandidates:
        i === 2 ? ["Queen of Hearts", "Queen of Diamonds"] : [],
    })), ...(variant === "identity-review" ? [{
      label: "Queen",
      category: "character",
      canonicalName: "Queen",
      aliases: [],
      reviewRequired: false,
    }] : [])],
  };
}
