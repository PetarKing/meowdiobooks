import type { CastArtifact, CastVoice, VoiceRoute } from "./api/contracts";

function comparisonKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function suggestedMemberIds(group: CastVoice, identities: CastVoice[]) {
  const candidates = [group.name, ...(group.literalLabels ?? [])];
  for (const candidate of candidates) {
    if (!/(?:&|\/|\band\b)/iu.test(candidate)) continue;
    const parts = candidate.split(/\s*(?:&|\/|\band\b)\s*/iu).filter(Boolean);
    const matches = parts.map((part) => identities.filter((identity) =>
      identity.category === "character"
      && [identity.name, ...(identity.literalLabels ?? [])].some((label) => comparisonKey(label) === comparisonKey(part)),
    ));
    if (matches.length >= 2 && matches.every((rows) => rows.length === 1)) {
      const ids = matches.map((rows) => rows[0].characterId);
      if (new Set(ids).size === ids.length) return ids;
    }
  }
  return [];
}

export function voiceRoutesForCast(cast?: CastArtifact): Record<string, VoiceRoute> {
  const identities = cast?.identities ?? [];
  return Object.fromEntries(identities
    .filter((voice) => voice.category === "group")
    .map((voice) => {
      if (voice.voiceRoute) return [voice.characterId, voice.voiceRoute];
      const suggestedIds = suggestedMemberIds(voice, identities);
      return [
        voice.characterId,
        suggestedIds.length >= 2
          ? { kind: "layered", characterIds: suggestedIds }
          : { kind: "dedicated" },
      ];
    }));
}

export function confirmedVoiceRoutesForCast(cast?: CastArtifact) {
  return Object.fromEntries((cast?.identities ?? [])
    .filter((voice) => voice.category === "group")
    .map((voice) => [voice.characterId, voice.voiceRoute?.kind === "layered"]));
}
