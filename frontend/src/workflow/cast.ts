import type { CastArtifact, CastVoice, VoiceRoute } from "../api/contracts";
import { strongConfirmationLabelsForCast, type IdentityDecision } from "../castIdentity";
import appI18n from "../i18n";

export const defaultNarratorDirection = "Warm, clear audiobook narrator with precise, natural delivery.";

export function decisionsForCast(cast: CastArtifact): Record<string, IdentityDecision> {
  if (cast.identityDecisions?.length) {
    return Object.fromEntries(cast.identityDecisions.map((row) => [row.label, row]));
  }
  const key = (value: string) => value.trim().toLocaleLowerCase();
  const proposals = new Map(cast.proposals.map((row) => [key(row.label), row]));
  const dossiers = new Map(cast.dossiers.map((row) => [key(row.label), row]));
  const decisions = cast.proposals.map((row) => {
    const reciprocal = (row.aliases ?? []).filter((alias) =>
      proposals.get(key(alias))?.aliases?.some((candidate) => key(candidate) === key(row.label)),
    );
    const members = [row.label, ...reciprocal];
    const canonicalLabel = members.find((label) => key(label) === key(row.canonicalName ?? ""));
    const primaryLabel = canonicalLabel ?? [...members].sort((left, right) =>
      (dossiers.get(key(right))?.occurrenceCount ?? 0) - (dossiers.get(key(left))?.occurrenceCount ?? 0)
        || left.localeCompare(right),
    )[0];
    return { label: row.label, category: row.category, canonicalName: row.canonicalName ?? "", aliases: [], primaryLabel };
  });
  return Object.fromEntries(decisions.map((row) => [row.label, row]));
}

export function resolvedLabelsForCast(cast: CastArtifact) {
  if (cast.phase !== "identity-review") return cast.proposals.map((row) => row.label);
  const decisions = decisionsForCast(cast);
  const confirmationLabels = new Set(strongConfirmationLabelsForCast(cast, decisions));
  return cast.proposals.filter((row) => !confirmationLabels.has(row.label)).map((row) => row.label);
}

export function identityDecisionSignature(decisions: Record<string, IdentityDecision>) {
  return JSON.stringify(Object.values(decisions).map((row) => ({
    label: row.label,
    category: row.category,
    canonicalName: row.canonicalName,
    aliases: [...row.aliases].sort(),
    primaryLabel: row.primaryLabel ?? "",
  })).sort((left, right) => left.label.localeCompare(right.label)));
}

export function voiceHasRevision(voice: CastVoice, revision?: string) {
  if (!revision) return false;
  if (voice.voiceCandidates?.length) {
    return voice.voiceCandidates.some((candidate) => candidate.revision === revision);
  }
  return voice.voicePreviewRevision === revision;
}

export function chosenVoiceRevision(voice: CastVoice, selections: Record<string, string>) {
  const approved = selections[voice.characterId];
  if (voiceHasRevision(voice, approved)) return approved;
  return voice.voiceCandidates?.find((candidate) => candidate.previewUrl)?.revision
    ?? (voiceHasRevision(voice, voice.voicePreviewRevision) ? voice.voicePreviewRevision : undefined);
}

export function acceptedVoiceSelections(cast?: CastArtifact) {
  const voices = [cast?.narrator, ...(cast?.identities ?? [])].filter(Boolean) as CastVoice[];
  return Object.fromEntries(voices.flatMap((voice) =>
    voice.voiceAccepted && voiceHasRevision(voice, voice.acceptedVoiceRevision)
      ? [[voice.characterId, voice.acceptedVoiceRevision!]]
      : [],
  ));
}

export function automaticSharedVoiceSelections(cast?: CastArtifact) {
  const voices = [cast?.narrator, ...(cast?.identities ?? [])].filter(Boolean) as CastVoice[];
  return Object.fromEntries(voices.flatMap((voice) => {
    const revision = voice.voicePreviewRevision;
    const candidate = voice.voiceCandidates?.find((row) => row.revision === revision);
    return revision && candidate?.source === "shared"
      ? [[voice.characterId, revision]]
      : [];
  }));
}

export function routeForVoice(voice: CastVoice, routes: Record<string, VoiceRoute>): VoiceRoute {
  return voice.category === "group"
    ? routes[voice.characterId] ?? voice.voiceRoute ?? { kind: "dedicated" }
    : { kind: "dedicated" };
}

export function summarizedVoiceNames(voices: CastVoice[]) {
  const names = voices.map((voice) => voice.name);
  if (names.length <= 4) return names.join(", ");
  return appI18n.t("{{names}}, and {{count}} more", { names: names.slice(0, 3).join(", "), count: names.length - 3 });
}
