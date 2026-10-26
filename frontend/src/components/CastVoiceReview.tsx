import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { WorkflowGateway, CastArtifact, CastVoice, VoiceCandidate, VoiceRoute, VoiceSampleTranscript, VoiceSettings } from "../api/contracts";
import { CollectionToolbar } from "./CollectionToolbar";
import { CastRosterCard } from "./CastRosterCard";
import { collectionMatches } from "./collectionSearch";
import { InspectorDialog } from "./Ui";
import { chosenVoiceRevision } from "../workflow/cast";
import { suggestedMemberIds } from "../voiceRoutes";
import { isActionRequiredError } from '../api/actionRequired';

interface Props {
  bookId: string;
  layeredVoicePreviewUrl?: WorkflowGateway["layeredVoicePreviewUrl"];
  cast: CastArtifact;
  selections: Record<string, string>;
  routes: Record<string, VoiceRoute>;
  confirmedRoutes?: Record<string, boolean>;
  onRouteChange: (characterId: string, route: VoiceRoute) => void;
  onConfirmRoute?: (characterId: string) => void;
  onApprove: (characterId: string, revision: string) => void;
  onRegenerate: (characterId: string, settings: VoiceSettings) => void;
  onTranscribe?: (file: File) => Promise<VoiceSampleTranscript>;
  onUpload?: (characterId: string, file: File, referenceText: string) => void;
  /** Retained for host source compatibility; audition deletion has no UI control. */
  onDelete?: (characterId: string, revision: string) => void;
  regeneratingCharacterId?: string;
  uploadingCharacterId?: string;
  deletingVoiceRevision?: string;
}

function candidatesFor(voice: CastVoice): VoiceCandidate[] {
  if (voice.voiceCandidates?.length) return voice.voiceCandidates;
  if (!voice.voicePreviewRevision) return [];
  return [{
    revision: voice.voicePreviewRevision,
    previewUrl: voice.previewUrl ?? "",
    referenceText: voice.referenceText ?? "",
    direction: voice.voiceDirection ?? "",
  }];
}

function candidateForRevision(voice: CastVoice, revision?: string) {
  return candidatesFor(voice).find((candidate) => candidate.revision === revision);
}

function approvedRevisionFor(voice: CastVoice, selections: Record<string, string>) {
  const revision = selections[voice.characterId];
  return candidateForRevision(voice, revision) ? revision : undefined;
}

function tilePreviewFor(voice: CastVoice, selections: Record<string, string>) {
  return candidateForRevision(voice, chosenVoiceRevision(voice, selections));
}

function sharedGroupFor(voice: CastVoice, selections: Record<string, string>) {
  return tilePreviewFor(voice, selections)?.sharedVoiceGroupId;
}

function stableHue(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

function sharedGroupStyles(groupIds: string[]) {
  const used: number[] = [];
  return new Map(groupIds.slice().sort().map((groupId) => {
    let hue = stableHue(groupId);
    let attempts = 0;
    while (attempts < 24 && used.some((candidate) => Math.min(Math.abs(candidate - hue), 360 - Math.abs(candidate - hue)) < 14)) {
      hue = (hue + 137) % 360;
      attempts += 1;
    }
    while (used.includes(hue)) hue = (hue + 137) % 360;
    used.push(hue);
    return [groupId, {
      "--shared-voice-accent": `hsl(${hue} 31% 45%)`,
      "--shared-voice-wash": `hsl(${hue} 38% 94%)`,
    } as CSSProperties];
  }));
}

function routeFor(voice: CastVoice, routes: Record<string, VoiceRoute>): VoiceRoute {
  return voice.category === "group"
    ? routes[voice.characterId] ?? voice.voiceRoute ?? { kind: "dedicated" }
    : { kind: "dedicated" };
}

function layeredPreviewUrl(
  bookId: string,
  voice: CastVoice,
  voices: CastVoice[],
  routes: Record<string, VoiceRoute>,
  selections: Record<string, string>,
  resolvePreview?: WorkflowGateway["layeredVoicePreviewUrl"],
) {
  const route = routeFor(voice, routes);
  if (route.kind !== "layered" || route.characterIds.length < 2) return undefined;
  const params = new URLSearchParams();
  const members: { characterId: string; revision: string }[] = [];
  for (const characterId of route.characterIds) {
    const member = voices.find((candidate) => candidate.characterId === characterId);
    const audition = member ? tilePreviewFor(member, selections) : undefined;
    if (!member || member.category !== "character" || !audition) return undefined;
    members.push({ characterId, revision: audition.revision });
    params.append("member", `${characterId}:${audition.revision}`);
  }
  if (resolvePreview) return resolvePreview(bookId, members);
  return `/api/books/${encodeURIComponent(bookId)}/voices/layered/audio?${params.toString()}`;
}

function candidateSummary(candidate: VoiceCandidate, t: TFunction) {
  if (candidate.source === "upload") {
    return candidate.durationSeconds == null
      ? t("Cloned from an uploaded sample")
      : t("Cloned from a {{seconds}} sec sample", { seconds: candidate.durationSeconds.toFixed(1) });
  }
  const settings = candidate.voiceSettings;
  if (!settings) return candidate.direction;
  const accent = settings.accent && settings.accent !== "unspecified" ? settings.accent : t("neutral accent");
  return `${t(label(settings.tone))} · ${t(label(settings.pace))} · ${accent}`;
}

function initials(name: string) {
  const parts = name.match(/[\p{L}\p{N}]+|&/gu) ?? [];
  const words = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part !== "&")
    .slice(0, 2);
  if (!words.length) return "—";
  const connector = words.length === 2 && parts.slice(words[0].index + 1, words[1].index).includes("&") ? "&" : "";
  return words.map(({ part }) => part[0]).join(connector).toUpperCase();
}

function settingsFor(voice: CastVoice): VoiceSettings {
  return voice.voiceSettings ?? {
    presentation: "unspecified",
    age: voice.characterId === "narrator" ? "adult" : "unspecified",
    tone: voice.characterId === "narrator" ? "warm" : "neutral",
    pitch: voice.characterId === "narrator" ? "medium" : "unspecified",
    pace: voice.characterId === "narrator" ? "measured" : "natural",
    energy: "balanced",
    accent: "unspecified",
    description: "",
  };
}

function comparisonKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function lineCountFor(voice: CastVoice, cast: CastArtifact) {
  if (typeof voice.lineCount === "number") return voice.lineCount;
  if (voice.characterId === "narrator") return undefined;
  const labels = new Set((voice.literalLabels ?? []).map(comparisonKey));
  return cast.dossiers.reduce(
    (total, dossier) => total + (labels.has(comparisonKey(dossier.label)) ? dossier.occurrenceCount ?? 0 : 0),
    0,
  );
}

function lineCountLabel(count: number | undefined, t: TFunction) {
  if (count == null) return t("Line count pending");
  return t(count === 1 ? "{{count}} line" : "{{count}} lines", { count });
}

const options = {
  presentation: ["unspecified", "feminine", "masculine", "androgynous"],
  age: ["unspecified", "child", "young-adult", "adult", "older-adult"],
  tone: ["neutral", "warm", "bright", "dark", "gentle", "crisp", "gravelly"],
  pitch: ["unspecified", "low", "medium", "high"],
  pace: ["measured", "natural", "brisk"],
  energy: ["restrained", "balanced", "animated"],
} as const;

const accentLimit = 48;
const performanceNotesLimit = 180;
const sampleTranscriptLimit = 2_000;

function label(value: string) {
  return value === "unspecified" ? "Unspecified" : value.replaceAll("-", " ").replace(/^./, (character) => character.toUpperCase());
}

function audioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function CastVoiceReview({
  bookId, layeredVoicePreviewUrl, cast, selections, routes, confirmedRoutes = {}, onRouteChange, onConfirmRoute, onApprove, onRegenerate, onTranscribe, onUpload, regeneratingCharacterId, uploadingCharacterId,
}: Props) {
  const { t } = useTranslation();
  const voices = useMemo(
    () => [
      cast.narrator,
      ...(cast.identities ?? []).slice().sort((left, right) =>
        (lineCountFor(right, cast) ?? 0) - (lineCountFor(left, cast) ?? 0)
          || left.name.localeCompare(right.name),
      ),
    ].filter(Boolean) as CastVoice[],
    [cast],
  );
  const voiceById = useMemo(
    () => Object.fromEntries(voices.map((voice) => [voice.characterId, voice])),
    [voices],
  );
  const sharedGroupColors = useMemo(() => new Map(
    [...new Set(voices.map((voice) => sharedGroupFor(voice, selections)).filter(Boolean) as string[])]
      .sort()
      .map((groupId, index) => [groupId, index]),
  ), [voices, selections]);
  const sharedVoiceStyles = useMemo(
    () => sharedGroupStyles([...sharedGroupColors.keys()]),
    [sharedGroupColors],
  );
  const previewUrlFor = (voice: CastVoice) => routeFor(voice, routes).kind === "layered"
    ? layeredPreviewUrl(bookId, voice, voices, routes, selections, layeredVoicePreviewUrl)
    : tilePreviewFor(voice, selections)?.previewUrl;
  const routeReady = (voice: CastVoice) => {
    const route = routeFor(voice, routes);
    return route.kind === "layered"
      ? confirmedRoutes[voice.characterId] === true
        && route.characterIds.length >= 2
        && new Set(route.characterIds).size === route.characterIds.length
        && route.characterIds.every((id) => voiceById[id]?.category === "character" && Boolean(tilePreviewFor(voiceById[id], selections)))
      : Boolean(approvedRevisionFor(voice, selections));
  };
  const requiresReview = (voice: CastVoice) => routeFor(voice, routes).kind === "layered" ? !routeReady(voice) : !tilePreviewFor(voice, selections);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const largeCollection = voices.length > 12;
  const visibleVoices = largeCollection ? voices.filter((voice) => collectionMatches(collectionQuery, [voice.name, ...(voice.literalLabels ?? [])])
    && (collectionFilter === "all" || (collectionFilter === "required" ? requiresReview(voice) : collectionFilter === "approved" ? routeReady(voice) : !routeReady(voice) && !requiresReview(voice)))) : voices;
  const selectedCount = voices.filter(routeReady).length;
  const requiredCount = voices.filter(requiresReview).length;
  const defaultReadyCount = voices.length - selectedCount - requiredCount;
  const [inspectedId, setInspectedId] = useState<string>();
  const inspected = voices.find((voice) => voice.characterId === inspectedId);
  const [settings, setSettings] = useState<VoiceSettings>();
  const [auditionSource, setAuditionSource] = useState<"designed" | "sample">("designed");
  const [sampleTranscript, setSampleTranscript] = useState("");
  const [sampleFile, setSampleFile] = useState<File>();
  const [samplePreviewUrl, setSamplePreviewUrl] = useState("");
  const [sampleTranscription, setSampleTranscription] = useState<"idle" | "transcribing" | "ready" | "failed" | "paused">("idle");
  const [sampleLanguage, setSampleLanguage] = useState<string>();
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [sampleElapsed, setSampleElapsed] = useState(0);
  const [sampleDuration, setSampleDuration] = useState(0);
  const [auditionMode, setAuditionMode] = useState<"auditions" | "create">("auditions");
  const pendingAudition = useRef<{ characterId: string; revisions: Set<string> } | undefined>(undefined);
  const [newAuditionRevision, setNewAuditionRevision] = useState<string>();
  const newAuditionPlayRef = useRef<HTMLButtonElement>(null);
  const [playingTileId, setPlayingTileId] = useState<string>();
  const tilePlaybackRequest = useRef(0);
  const [playingCandidateRevision, setPlayingCandidateRevision] = useState<string>();
  const candidatePlaybackRequest = useRef(0);
  const [inspectorClosing, setInspectorClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const tileAudioRef = useRef<HTMLAudioElement | null>(null);
  const candidateAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptionRequest = useRef(0);
  const focusAfterClose = useRef<string | undefined>(undefined);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previousInspectedId = useRef<string | undefined>(undefined);
  const previousPreviewRevision = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const inspector = inspectorRef.current;
    if (inspector) inspector.scrollTop = 0;
  }, [auditionMode]);

  useEffect(() => {
    candidatePlaybackRequest.current += 1;
    pauseCandidatePlayback();
    setPlayingCandidateRevision(undefined);
  }, [auditionMode, inspectedId]);

  useEffect(() => {
    if (!inspected) {
      previousInspectedId.current = undefined;
      previousPreviewRevision.current = undefined;
      return;
    }
    const sameCharacter = previousInspectedId.current === inspected.characterId;
    const submitted = pendingAudition.current;
    const newCandidate = submitted?.characterId === inspected.characterId
      ? candidatesFor(inspected).find((candidate) => !submitted.revisions.has(candidate.revision))
      : undefined;
    const regenerated = sameCharacter
      && previousPreviewRevision.current !== undefined
      && previousPreviewRevision.current !== inspected.voicePreviewRevision;
    setSettings(settingsFor(inspected));
    if (!sameCharacter) {
      setAuditionMode("auditions");
      setAuditionSource("designed");
      setSampleTranscript("");
      setSampleFile(undefined);
      setSamplePreviewUrl("");
      setSampleTranscription("idle");
      setSampleLanguage(undefined);
      setSamplePlaying(false);
      setSampleElapsed(0);
      setSampleDuration(0);
      transcriptionRequest.current += 1;
    }
    if (newCandidate) {
      pendingAudition.current = undefined;
      setNewAuditionRevision(newCandidate.revision);
      setAuditionMode("auditions");
    } else if (regenerated) setAuditionMode("auditions");
    previousInspectedId.current = inspected.characterId;
    previousPreviewRevision.current = inspected.voicePreviewRevision;
  }, [inspected]);

  useEffect(() => {
    if (auditionMode !== "auditions" || !newAuditionRevision) return;
    newAuditionPlayRef.current?.focus();
    setNewAuditionRevision(undefined);
  }, [auditionMode, newAuditionRevision]);

  useEffect(() => () => {
    if (samplePreviewUrl) URL.revokeObjectURL(samplePreviewUrl);
  }, [samplePreviewUrl]);

  useEffect(() => () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    const audio = tileAudioRef.current;
    if (audio?.getAttribute("src")) audio.pause();
    pauseCandidatePlayback();
    sampleAudioRef.current?.pause();
  }, []);

  async function chooseSample(sample: File) {
    const request = transcriptionRequest.current + 1;
    transcriptionRequest.current = request;
    sampleAudioRef.current?.pause();
    setSampleFile(sample);
    setSamplePreviewUrl(URL.createObjectURL(sample));
    setSampleTranscript("");
    setSampleLanguage(undefined);
    setSamplePlaying(false);
    setSampleElapsed(0);
    setSampleDuration(0);
    if (!onTranscribe) {
      setSampleTranscription("idle");
      return;
    }
    setSampleTranscription("transcribing");
    try {
      const draft = await onTranscribe(sample);
      if (transcriptionRequest.current !== request) return;
      setSampleTranscript(draft.text.slice(0, sampleTranscriptLimit));
      setSampleLanguage(draft.language?.trim() || undefined);
      setSampleTranscription("ready");
    } catch (reason) {
      if (transcriptionRequest.current !== request) return;
      setSampleTranscription(isActionRequiredError(reason) && reason.handled ? 'paused' : 'failed');
    }
  }

  function toggleSamplePreview() {
    const audio = sampleAudioRef.current;
    if (!audio) return;
    if (samplePlaying) {
      audio.pause();
      setSamplePlaying(false);
      return;
    }
    try {
      const playback = audio.play();
      setSamplePlaying(true);
      if (playback) void playback.catch(() => setSamplePlaying(false));
    } catch {
      setSamplePlaying(false);
    }
  }

  function toggleTilePreview(voice: CastVoice) {
    const audio = tileAudioRef.current;
    const previewUrl = previewUrlFor(voice);
    if (!audio || !previewUrl) return;
    const request = ++tilePlaybackRequest.current;
    if (playingTileId === voice.characterId) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingTileId(undefined);
      return;
    }
    audio.pause();
    audio.src = previewUrl;
    setPlayingTileId(voice.characterId);
    try {
      const playback = audio.play();
      if (playback) void playback.catch(() => { if (tilePlaybackRequest.current === request) setPlayingTileId(undefined); });
    } catch {
      setPlayingTileId(undefined);
    }
  }

  function toggleCandidatePreview(candidate: VoiceCandidate) {
    const audio = candidateAudioRef.current;
    if (!audio || !candidate.previewUrl) return;
    const request = ++candidatePlaybackRequest.current;
    if (playingCandidateRevision === candidate.revision) {
      pauseCandidatePlayback();
      audio.currentTime = 0;
      setPlayingCandidateRevision(undefined);
      return;
    }
    pauseCandidatePlayback();
    audio.src = candidate.previewUrl;
    audio.currentTime = 0;
    setPlayingCandidateRevision(candidate.revision);
    try {
      const playback = audio.play();
      if (playback) void playback.catch(() => { if (candidatePlaybackRequest.current === request) setPlayingCandidateRevision(undefined); });
    } catch {
      setPlayingCandidateRevision(undefined);
    }
  }

  function pauseCandidatePlayback() {
    const audio = candidateAudioRef.current;
    if (audio && !audio.paused) audio.pause();
  }

  function openInspector(characterId: string) {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    pendingAudition.current = undefined;
    setNewAuditionRevision(undefined);
    tilePlaybackRequest.current += 1;
    if (playingTileId) tileAudioRef.current?.pause();
    setPlayingTileId(undefined);
    setInspectorClosing(false);
    setInspectedId(characterId);
  }

  function finishInspectorClose() {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setInspectedId(undefined);
    setInspectorClosing(false);
  }

  useEffect(() => {
    if (inspectedId || !focusAfterClose.current) return;
    if (focusAfterClose.current) {
      const target = tileRefs.current[focusAfterClose.current] ?? workbenchRef.current?.querySelector<HTMLInputElement>(".collection-search input");
      target?.focus();
    }
    focusAfterClose.current = undefined;
  }, [inspectedId]);

  function closeInspector() {
    if (!inspected || inspectorClosing) return;
    pendingAudition.current = undefined;
    candidatePlaybackRequest.current += 1;
    pauseCandidatePlayback();
    setPlayingCandidateRevision(undefined);
    focusAfterClose.current = inspected.characterId;
    setInspectorClosing(true);
    closeTimer.current = window.setTimeout(finishInspectorClose, 260);
  }

  const inspectedCandidates = inspected ? candidatesFor(inspected) : [];
  const approvedRevision = inspected ? approvedRevisionFor(inspected, selections) : undefined;
  const inspectedSharedGroup = inspected ? sharedGroupFor(inspected, selections) : undefined;
  const inspectedRoute = inspected ? routeFor(inspected, routes) : { kind: "dedicated" } as VoiceRoute;
  const inspectedReady = inspected ? routeReady(inspected) : false;
  const inspectedRequired = inspected ? requiresReview(inspected) : false;
  const inspectedPreviewUrl = inspected ? previewUrlFor(inspected) : undefined;
  const memberVoices = (cast.identities ?? []).filter((voice) => voice.category === "character");
  const suggestedIds = inspected?.category === "group" ? suggestedMemberIds(inspected, memberVoices) : [];
  const performanceNotesTooLong = (settings?.description.length ?? 0) > performanceNotesLimit;

  function rememberAuditionSubmission() {
    if (!inspected) return;
    pendingAudition.current = {
      characterId: inspected.characterId,
      revisions: new Set(inspectedCandidates.map((candidate) => candidate.revision)),
    };
  }

  return <div ref={workbenchRef} className="cast-workbench voice-cast-workbench">
    <div className="cast-toolbar voice-cast-toolbar">
      <p className="voice-cast-progress" aria-label={t("Voice review progress")}>
        {selectedCount > 0 && <span className="approved">{t("{{count}} approved", { count: selectedCount })}</span>}
        {defaultReadyCount > 0 && <span className="pending"><b>{t("{{count}} not yet approved", { count: defaultReadyCount })}</b></span>}
        {requiredCount > 0 && <span className="required"><b>{t("{{count}} required", { count: requiredCount })}</b><small>{t("Blocks continue")}</small></span>}
      </p>
      {requiredCount > 0 && <button type="button" className="primary compact" onClick={() => { const next = voices.find(requiresReview); if(next) openInspector(next.characterId); }}>{t("Review required voices")} →</button>}
    </div>

    {largeCollection && <CollectionToolbar query={collectionQuery} onQueryChange={setCollectionQuery} filter={collectionFilter} onFilterChange={setCollectionFilter} searchLabel={t("Search cast")} filterLabel={t("Show cast")} countLabel={t("{{shown}} of {{total}} cast members shown", { shown: visibleVoices.length, total: voices.length })} clearLabel={t("Clear")} filters={[
      { value: "all", label: t("All") }, { value: "required", label: t("Required") }, { value: "approved", label: t("Voice approved") }, { value: "ready", label: t("Default audition ready") },
    ]} />}
    {largeCollection && !visibleVoices.length && <div className="collection-empty"><b>{t("No cast members match these filters.")}</b><span>{t("Clear the search and filter to see the whole cast.")}</span><button type="button" className="ghost" onClick={() => { setCollectionQuery(""); setCollectionFilter("all"); }}>{t("Clear")}</button></div>}
    <section className="cast-board voice-cast-board" aria-label={t("Cast voice auditions")}>
      {visibleVoices.map((voice) => {
        const selected = routeReady(voice);
        const required = requiresReview(voice);
        const isNarrator = voice.characterId === "narrator";
        const previewUrl = previewUrlFor(voice);
        const playing = playingTileId === voice.characterId;
        const sharedGroupId = sharedGroupFor(voice, selections);
        const sharedColor = sharedGroupId == null ? undefined : sharedGroupColors.get(sharedGroupId);
        const priorBookApplied = !required && routeFor(voice, routes).kind === "dedicated" && tilePreviewFor(voice, selections)?.source === "previous-book";
        const statusLabel = priorBookApplied ? t("From prior book") : t(routeFor(voice, routes).kind === "layered" ? selected ? "voices layered" : "confirm suggested voices" : selected ? sharedGroupId ? "shared voice" : "voice selected" : required ? "audition required" : "not yet approved");
        return <CastRosterCard
          key={voice.characterId}
          name={voice.name} symbol={isNarrator ? "N" : initials(voice.name)}
          cardClassName={priorBookApplied ? "previous-book-match" : selected ? "is-approved" : required ? "is-required" : "is-pending"}
          portraitClassName={`portrait-tone-${Math.floor(stableHue(voice.characterId) / 90)} ${isNarrator ? "cast-narrator-tile" : ""} ${selected ? "voice-selected" : required ? "voice-required" : "voice-pending"}`}
          detailClassName={`${isNarrator ? "cast-narrator-tile" : ""} ${selected ? "voice-selected" : required ? "voice-required needs-review" : "voice-pending voice-default-ready"} ${sharedColor == null ? "" : `shared-voice shared-voice-${sharedColor}`}`}
          dataSharedVoiceGroup={sharedGroupId}
          style={sharedGroupId ? sharedVoiceStyles.get(sharedGroupId) : undefined}
          portraitContent={playing ? <span className="voice-tile-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span> : undefined}
          portraitCue={previewUrl && !playing ? <span className="voice-tile-play-cue" aria-hidden="true"><PlaybackIcon /></span> : undefined}
          badge={priorBookApplied ? <span className="previous-book-badge">{t("From prior book")}</span> : !selected && <span className={`cast-review-badge voice-tile-alert ${required ? "required" : "advisory pending"}`}><b>{t(required ? routeFor(voice, routes).kind === "layered" ? "Confirm layered voices" : "Audition required" : "Not yet approved")}</b></span>}
          detail={voice.category === "group" ? t(label(voice.category)) : undefined}
          previewProps={{ "aria-label": t("{{action}} {{name}} preview", { action: t(playing ? "Stop" : "Play"), name: voice.name }), "aria-pressed": playing, disabled: !previewUrl, onClick: () => toggleTilePreview(voice) }}
          inspectRef={(element) => { tileRefs.current[voice.characterId] = element; }}
          inspectProps={{ "aria-label": t("Open {{name}} voice", { name: voice.name }), "aria-description": required ? `${t("Required")}: ${statusLabel}` : !selected && sharedGroupId ? `${statusLabel} · ${t("shared voice")}` : statusLabel, onClick: () => openInspector(voice.characterId) }}
        />;
      })}
    </section>
    <audio ref={tileAudioRef} className="voice-tile-audio" preload="metadata" onEnded={() => { tilePlaybackRequest.current += 1; setPlayingTileId(undefined); }} onError={() => { tilePlaybackRequest.current += 1; setPlayingTileId(undefined); }} />

    {inspected && <InspectorDialog surfaceRef={inspectorRef} label={t("{{name}} voice", { name: inspected.name })} className={`voice-inspector ${auditionMode === "create" ? "voice-inspector-creating" : ""}`} closing={inspectorClosing} onClose={closeInspector} onClosed={finishInspectorClose}>
        <header className="cast-inspector-head">
          {auditionMode === "create" ? <div className="voice-create-header-copy">
            <h2>{t("Create a new audition")}</h2>
            <p>{inspected.name}</p>
          </div> : <div>
            <span className={`cast-status-dot ${inspectedReady ? "ready" : inspectedRequired ? "needs-review" : "default-ready"}`} />
            <small>{t(inspectedReady ? inspectedRoute.kind === "layered" ? "Layered voices ready" : inspectedSharedGroup ? "Shared voice selected" : "Voice approved" : inspectedRoute.kind === "layered" ? "Confirm suggested voices" : inspectedRequired ? "Audition required" : "Default audition ready")}</small>
            <h2>{inspected.name}</h2>
            <p>{t(label(inspected.category ?? (inspected.characterId === "narrator" ? "narrator" : "character")))} · {lineCountLabel(lineCountFor(inspected, cast), t)} · {cast.language ? t(cast.language) : t("Unknown language")}</p>
          </div>}
          <div className="cast-inspector-actions">
            {auditionMode === "create" && <button type="button" className="voice-create-back" onClick={() => setAuditionMode("auditions")}>← {t("Back to auditions")}</button>}
            <button type="button" className="cast-inspector-close" aria-label={t("Close voice")} onClick={closeInspector}>×</button>
          </div>
        </header>

        {auditionMode === "auditions" && !inspectedReady && <p className={`cast-review-explanation ${inspectedRequired ? "required" : "advisory"}`}><strong>{t(inspectedRequired ? "Required before continuing" : "Optional check")}</strong><span>{t(inspectedRequired ? inspectedRoute.kind === "layered" ? "Complete and confirm this group’s layered voice route before continuing." : "Create an audition for this voice before continuing." : "Listen and choose if you like. You can approve the available audition when continuing.")}</span></p>}

        <div className="voice-inspector-body">
          {inspected.category === "group" && <section className="voice-route-section">
            <div className="cast-section-heading"><div><small>{t("Group voice")}</small><h3>{t("How should this group sound?")}</h3></div></div>
            <p className="voice-route-help">{t("Use one voice or layer existing cast voices. Character names and identities stay unchanged.")}</p>
            <div className="voice-route-choices" role="radiogroup" aria-label={t("Group voice route")}>
              <button type="button" role="radio" aria-checked={inspectedRoute.kind === "dedicated"} className={inspectedRoute.kind === "dedicated" ? "selected" : ""} onClick={() => onRouteChange(inspected.characterId, { kind: "dedicated" })}>
                <span>{inspectedRoute.kind === "dedicated" ? "●" : "○"}</span><b>{t("Dedicated group voice")}</b><small>{t("Use one audition made for {{name}}.", { name: inspected.name })}</small>
              </button>
              <button type="button" role="radio" aria-checked={inspectedRoute.kind === "layered"} className={inspectedRoute.kind === "layered" ? "selected" : ""} onClick={() => onRouteChange(inspected.characterId, { kind: "layered", characterIds: inspectedRoute.kind === "layered" ? inspectedRoute.characterIds : suggestedIds })}>
                <span>{inspectedRoute.kind === "layered" ? "●" : "○"}</span><b>{t("Layer existing cast voices")}</b><small>{t("Each selected character performs the same group line.")}</small>
              </button>
            </div>
            {inspectedRoute.kind === "dedicated" && suggestedIds.length >= 2 && <div className="voice-route-suggestion">
              <span><b>{t("Suggested voices")}</b><small>{suggestedIds.map((id) => voiceById[id]?.name).filter(Boolean).join(" + ")}</small></span>
              <button type="button" className="ghost" onClick={() => onRouteChange(inspected.characterId, { kind: "layered", characterIds: suggestedIds })}>{t("Use suggestion")}</button>
            </div>}
            {inspectedRoute.kind === "layered" && <div className="voice-route-members">
              <div className={`voice-route-confirmation ${confirmedRoutes[inspected.characterId] ? "confirmed" : "pending"}`}>
                <span><b>{t(confirmedRoutes[inspected.characterId] ? "Layered route confirmed" : "Confirm suggested voices")}</b><small>{inspectedRoute.characterIds.map((id) => voiceById[id]?.name).filter(Boolean).join(" + ") || t("Choose the members of this group.")}</small></span>
                {!confirmedRoutes[inspected.characterId] && <button type="button" className="primary" disabled={!inspectedPreviewUrl} onClick={() => onConfirmRoute?.(inspected.characterId)}>{t("Confirm layered voices")}</button>}
              </div>
              <div className="voice-route-chips">
                {inspectedRoute.characterIds.map((characterId) => <button type="button" key={characterId} aria-label={`Remove ${voiceById[characterId]?.name ?? characterId}`} onClick={() => onRouteChange(inspected.characterId, { kind: "layered", characterIds: inspectedRoute.characterIds.filter((id) => id !== characterId) })}>{voiceById[characterId]?.name ?? characterId}<span>×</span></button>)}
              </div>
              <label>{t("Add an existing cast voice")}<select aria-label={t("Add an existing cast voice")} value="" onChange={(event) => { const characterId = event.target.value; if (characterId) onRouteChange(inspected.characterId, { kind: "layered", characterIds: [...inspectedRoute.characterIds, characterId] }); }}><option value="">{t("Choose a character…")}</option>{memberVoices.filter((voice) => !inspectedRoute.characterIds.includes(voice.characterId)).map((voice) => <option key={voice.characterId} value={voice.characterId}>{voice.name}</option>)}</select></label>
              {inspectedPreviewUrl
                ? <div className="voice-route-preview"><span><b>{t("Combined preview")}</b><small>{t("Layers the currently applied member auditions.")}</small></span><audio key={inspectedPreviewUrl} controls preload="metadata" src={inspectedPreviewUrl} /></div>
                : <p className="voice-route-incomplete">{t("Choose at least two characters with playable auditions.")}</p>}
            </div>}
          </section>}

          {inspectedRoute.kind === "dedicated" && auditionMode === "auditions" && <section className="voice-candidates-section">
            <div className="cast-section-heading"><h3>{t("Voice auditions")}</h3><span>{inspectedCandidates.length}</span></div>
            {inspectedCandidates.length > 0 && (inspected.referenceText ? <blockquote>{inspected.referenceText}</blockquote> : <p className="cast-muted voice-no-script">{t("No audition text is available.")}</p>)}
            <p className="voice-candidates-help">{t(inspectedCandidates.length > 0 ? "Listen, then choose a voice. Your choice applies immediately and can be changed." : "No auditions yet. Create one to hear this cast member.")}</p>
            <div className="voice-candidate-grid">{inspectedCandidates.map((candidate, index) => {
              const number = index + 1;
              const applied = candidate.revision === approvedRevision;
              const selected = candidate.revision === chosenVoiceRevision(inspected, selections);
              const playingCandidate = playingCandidateRevision === candidate.revision;
              return <article key={candidate.revision} className={`voice-candidate-tile ${candidate.source === "previous-book" ? "previous-book-derived" : ""} ${candidate.source === "upload" ? "sample-derived" : ""} ${candidate.source === "shared" ? "shared-derived" : ""} ${selected ? "applied selected" : ""}`}>
                <div className="voice-candidate-actions">
                  <button type="button" className="voice-candidate-choice" aria-label={t("Apply Audition {{number}}", { number })} aria-pressed={selected} onClick={() => onApprove(inspected.characterId, candidate.revision)}>
                    <span><b>{t("Audition {{number}}", { number })}</b><small className={candidate.source === "previous-book" ? "previous-book-caption" : undefined}>{t(candidate.source === "previous-book" ? "From prior book" : candidate.source === "upload" ? "From your sample" : candidate.source === "shared" ? "Shared voice" : candidate.revision === inspected.voicePreviewRevision ? "Newest audition" : "Earlier audition")}</small><span className="voice-candidate-summary">{candidateSummary(candidate, t)}</span></span>
                    {applied && <strong className="candidate-applied-badge"><span aria-hidden="true">✓</span><span className="visually-hidden">{t("✓ Applied")}</span></strong>}
                  </button>
                </div>
                {candidate.previewUrl
                  ? <button type="button" ref={candidate.revision === newAuditionRevision ? newAuditionPlayRef : undefined} className={`voice-candidate-play ${playingCandidate ? "playing" : ""}`} aria-label={t("{{action}} Audition {{number}}", { action: t(playingCandidate ? "Stop" : "Play"), number })} aria-pressed={playingCandidate} onClick={() => toggleCandidatePreview(candidate)}>
                    <span className="voice-candidate-play-icon" aria-hidden="true"><PlaybackIcon state={playingCandidate ? "stop" : "play"} /></span>
                    <span>{t(playingCandidate ? "Stop audition" : "Play audition")}</span>
                    <span className="voice-candidate-play-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
                  </button>
                  : <small className="cast-muted">{t("No playable audio.")}</small>}
              </article>;
            })}
              <button type="button" className="voice-new-audition" onClick={() => { candidatePlaybackRequest.current += 1; pauseCandidatePlayback(); setPlayingCandidateRevision(undefined); setAuditionMode("create"); }} aria-label={t("Create a new audition")}>
                <span className="voice-new-audition-icon" aria-hidden="true">＋</span>
                <span><b>{t("New voice")}</b><small>{t("Create a new audition")}</small></span>
              </button>
            </div>
            <audio ref={candidateAudioRef} className="voice-candidate-audio" preload="metadata" onEnded={() => { candidatePlaybackRequest.current += 1; setPlayingCandidateRevision(undefined); }} onError={() => { candidatePlaybackRequest.current += 1; setPlayingCandidateRevision(undefined); }} />
          </section>}

          {inspectedRoute.kind === "dedicated" && settings && auditionMode === "create" && <section className="voice-settings-section voice-audition-settings">
            <p className="voice-create-intro">{t("Shape a performance for {{name}}.", { name: inspected.name })}</p>
            {onUpload && <div className="voice-source-choices" role="radiogroup" aria-label={t("Audition source")}>
              <button type="button" role="radio" aria-checked={auditionSource === "designed"} className={auditionSource === "designed" ? "selected" : ""} onClick={() => setAuditionSource("designed")}><span aria-hidden="true">✦</span><b>{t("Design a voice")}</b><small>{t("Shape its character and delivery.")}</small></button>
              <button type="button" role="radio" aria-checked={auditionSource === "sample"} className={auditionSource === "sample" ? "selected" : ""} onClick={() => setAuditionSource("sample")}><span aria-hidden="true">♫</span><b>{t("Clone from a sample")}</b><small>{t("Use one speaker as the reference.")}</small></button>
            </div>}
            {auditionSource === "designed" && <><div className="voice-settings-groups">
              <fieldset className="voice-setting-group voice-traits-group"><legend>{t("Voice traits")}</legend><div className="voice-trait-columns">
                <div className="voice-trait-column"><h4>{t("Character")}</h4><div className="voice-fields">
                  <VoiceSelect title={t("Gender")} field="presentation" value={settings.presentation} values={options.presentation} onChange={(value) => setSettings({ ...settings, presentation: value })} />
                  <VoiceSelect title={t("Age")} field="age" value={settings.age} values={options.age} onChange={(value) => setSettings({ ...settings, age: value })} />
                </div></div>
                <div className="voice-trait-column"><h4>{t("Sound")}</h4><div className="voice-fields">
                  <VoiceSelect title={t("Tone")} field="tone" value={settings.tone} values={options.tone} onChange={(value) => setSettings({ ...settings, tone: value })} />
                  <VoiceSelect title={t("Pitch")} field="pitch" value={settings.pitch} values={options.pitch} onChange={(value) => setSettings({ ...settings, pitch: value })} />
                </div></div>
                <div className="voice-trait-column"><h4>{t("Delivery")}</h4><div className="voice-fields">
                  <VoiceSelect title={t("Pace")} field="pace" value={settings.pace} values={options.pace} onChange={(value) => setSettings({ ...settings, pace: value })} />
                  <VoiceSelect title={t("Energy")} field="energy" value={settings.energy} values={options.energy} onChange={(value) => setSettings({ ...settings, energy: value })} />
                </div></div>
              </div></fieldset>
              <fieldset className="voice-setting-group voice-direction-group"><legend>{t("Direction")}</legend><div className="voice-fields">
                <label>{t("Accent")}<input maxLength={accentLimit} placeholder={t("e.g. Japanese or Southern English")} value={settings.accent} onChange={(event) => setSettings({ ...settings, accent: event.target.value })} /></label>
                <label><span className="field-label">{t("Performance notes")} <em>{t("Optional")}</em></span><textarea aria-label={t("Performance notes")} aria-describedby="performance-notes-help" aria-invalid={performanceNotesTooLong} maxLength={performanceNotesLimit} rows={4} value={settings.description} onChange={(event) => setSettings({ ...settings, description: event.target.value })} /><small id="performance-notes-help" className={performanceNotesTooLong ? "field-error" : "field-counter"}>{performanceNotesTooLong ? t("Use {{count}} characters or fewer.", { count: performanceNotesLimit }) : `${settings.description.length}/${performanceNotesLimit}`}</small></label>
              </div></fieldset>
            </div>
            <div className="voice-regenerate-footer">
              <button
                type="button"
                className="primary regenerate-voice-action"
                disabled={performanceNotesTooLong || regeneratingCharacterId === inspected.characterId}
                onClick={() => { rememberAuditionSubmission(); onRegenerate(inspected.characterId, { ...settings, accent: settings.accent.trim() || "unspecified", description: settings.description.trim() }); }}
              >
                {t(regeneratingCharacterId === inspected.characterId ? "Creating audition…" : "Generate new audition →")}
              </button>
            </div></>}
            {auditionSource === "sample" && onUpload && <div className="voice-sample-panel">
              <div><b>{t("Generate this line in the sampled voice")}</b><p>{t("voiceSample.help", { ns: "edition" })}</p></div>
              {!sampleFile && <label className={`voice-sample-upload ${uploadingCharacterId === inspected.characterId ? "busy" : ""}`}>
                <input
                  type="file"
                  aria-label={t("Choose voice sample")}
                  accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac"
                  disabled={uploadingCharacterId === inspected.characterId}
                  onChange={(event) => {
                    const sample = event.target.files?.[0];
                    event.target.value = "";
                    if (!sample) return;
                    void chooseSample(sample);
                  }}
                />
                <span>{t("Choose voice sample")}</span>
              </label>}
              {sampleFile && samplePreviewUrl && <div className="voice-sample-preview">
                <button type="button" className={`voice-sample-play ${samplePlaying ? "playing" : ""}`} aria-label={t(samplePlaying ? "Pause selected voice sample" : "Play selected voice sample")} onClick={toggleSamplePreview}><PlaybackIcon state={samplePlaying ? "pause" : "play"} /></button>
                <span className="voice-sample-preview-copy"><b title={sampleFile.name}>{sampleFile.name}</b><small>{sampleTranscription === "transcribing" ? t("voiceSample.draftingShort", { ns: "edition" }) : t("Play while checking the transcript below.")}</small></span>
                <span className="voice-sample-time">{audioTime(sampleElapsed)} / {audioTime(sampleDuration)}</span>
                <label className="voice-sample-replace"><input type="file" aria-label={t("Choose a different sample")} accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" disabled={uploadingCharacterId === inspected.characterId} onChange={(event) => { const sample = event.target.files?.[0]; event.target.value = ""; if (sample) void chooseSample(sample); }} /><span>{t("Replace")}</span></label>
                <audio ref={sampleAudioRef} aria-label={t("Selected voice sample preview")} preload="metadata" src={samplePreviewUrl} onLoadedMetadata={(event) => setSampleDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setSampleElapsed(event.currentTarget.currentTime)} onPause={() => setSamplePlaying(false)} onEnded={() => { setSamplePlaying(false); setSampleElapsed(sampleDuration); }} />
              </div>}
              <label className="voice-sample-transcript"><span>{t("What is said in the sample?")}</span><textarea aria-label={t("Voice sample transcript")} disabled={!sampleFile || sampleTranscription === "transcribing"} maxLength={sampleTranscriptLimit} rows={4} placeholder={t(!sampleFile ? "Choose a sample to draft its words…" : sampleTranscription === "transcribing" ? "Listening and drafting…" : "Type the sample’s exact spoken words…")} value={sampleTranscript} onChange={(event) => setSampleTranscript(event.target.value)} /><small>{sampleTranscript.length}/{sampleTranscriptLimit}</small></label>
              {sampleFile && <p className={`voice-transcript-status ${sampleTranscription}`} aria-live="polite">{sampleTranscription === "transcribing" ? t("voiceSample.draftingStatus", { ns: "edition" }) : sampleTranscription === "ready" ? t(sampleLanguage ? "Drafted in {{language}}. Check every word before continuing." : "Draft ready. Check every word before continuing.", { language: sampleLanguage }) : sampleTranscription === "paused" ? t("Complete the requested action, then retry the transcript draft.") : sampleTranscription === "failed" ? t("A draft could not be made. Type the exact words manually.") : t("Type the exact words spoken in the sample.")}</p>}
              {sampleTranscription === "paused" && sampleFile && <button type="button" className="ghost compact" onClick={() => { void chooseSample(sampleFile); }}>{t("Retry transcript draft")}</button>}
              <button
                type="button"
                className="primary voice-sample-submit"
                disabled={!sampleFile || !sampleTranscript.trim() || sampleTranscription === "transcribing" || uploadingCharacterId === inspected.characterId}
                onClick={() => { if (sampleFile) { rememberAuditionSubmission(); onUpload(inspected.characterId, sampleFile, sampleTranscript.trim()); } }}
              >{t(uploadingCharacterId === inspected.characterId ? "Creating cloned audition…" : "Create sampled audition →")}</button>
            </div>}
          </section>}

        </div>
    </InspectorDialog>}
  </div>;
}

function VoiceSelect<K extends keyof Pick<VoiceSettings, "presentation" | "age" | "tone" | "pitch" | "pace" | "energy">>({
  title, field, value, values, onChange,
}: {
  title: string;
  field: K;
  value: VoiceSettings[K];
  values: readonly VoiceSettings[K][];
  onChange: (value: VoiceSettings[K]) => void;
}) {
  const { t } = useTranslation();
  return <label>{title}<span className="voice-select-control"><select aria-label={title} value={value} onChange={(event) => onChange(event.target.value as VoiceSettings[K])}>{values.map((option) => <option key={option} value={option}>{t(label(option))}</option>)}</select><span aria-hidden="true">{t(label(value))}</span></span><input type="hidden" name={field} value={value} /></label>;
}


/** Fixed geometry keeps playback marks aligned across platforms and typefaces. */
function PlaybackIcon({ state = "play" }: { state?: "play" | "stop" | "pause" }) {
  return <svg className="voice-playback-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    {state === "play" ? <path d="M8 5.8a1 1 0 0 1 1.5-.86l10 6.2a1 1 0 0 1 0 1.72l-10 6.2A1 1 0 0 1 8 18.2Z" />
      : state === "stop" ? <rect x="6" y="6" width="12" height="12" rx="2" />
      : <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>}
  </svg>;
}
