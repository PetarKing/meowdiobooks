import { userFacingDetail } from "../workflow/presentation";
import { CollectionToolbar } from "./CollectionToolbar";
import { CastRosterCard } from "./CastRosterCard";
import { DismissibleDetails } from "./DismissibleDetails";
import { collectionMatches } from "./collectionSearch";
import { InspectorDialog as InspectorShell } from "./Ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { CastArtifact, CastDossier, CastProposal } from "../api/contracts";
import { strongConfirmationLabelsForCast, type IdentityDecision } from "../castIdentity";
import "./CastIdentityReview.css";
import { languageFlags as flags, LanguageFlags } from "./LanguagePicker";

interface CastGroup {
  key: string;
  name: string;
  category: string;
  labels: string[];
  primaryLabel: string;
  proposals: CastProposal[];
  dossiers: CastDossier[];
  occurrenceCount: number;
  needsReview: boolean;
  autoGrouped: boolean;
  qwenReview: boolean;
  hasSuggestions: boolean;
  advisoryReview: boolean;
}

interface Props {
  cast: CastArtifact;
  decisions: Record<string, IdentityDecision>;
  setDecisions: Dispatch<SetStateAction<Record<string, IdentityDecision>>>;
  resolvedLabels: string[];
  setResolvedLabels: Dispatch<SetStateAction<string[]>>;
  voiceModels: Array<{ id: string; label: string; recipeVersion?: string; supportedLanguages: string[] }>;
  voiceModel: string;
  language: string;
  onVoiceModelChange: (modelId: string) => void;
  onLanguageChange: (language: string) => void;
  hideVoiceModel?: boolean;
  hideVoiceSettings?: boolean;
  onReclassify?: () => void;
}

const NARRATOR_KEY = "narrator";
const DRAG_SCROLL_EDGE_PX = 96;
const DRAG_SCROLL_MIN_PX_PER_SECOND = 160;
const DRAG_SCROLL_MAX_PX_PER_SECOND = 1050;


function comparisonKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function searchTokens(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function fallbackDecision(proposal: CastProposal): IdentityDecision {
  return {
    label: proposal.label,
    category: proposal.category,
    canonicalName: proposal.canonicalName ?? "",
    aliases: [],
    primaryLabel: proposal.label,
  };
}

function makeGroups(
  cast: CastArtifact,
  decisions: Record<string, IdentityDecision>,
  resolvedLabels: string[],
): CastGroup[] {
  const confirmationLabels = new Set(strongConfirmationLabelsForCast(cast, decisions));
  const dossierByLabel = new Map(cast.dossiers.map((row) => [row.label, row]));
  const availableLabels = new Set(cast.proposals.map((proposal) => proposal.label));
  const groups = new Map<string, Omit<CastGroup, "primaryLabel" | "autoGrouped" | "qwenReview" | "hasSuggestions" | "advisoryReview">>();
  for (const proposal of cast.proposals) {
    const decision = decisions[proposal.label] ?? fallbackDecision(proposal);
    const narrator = decision.category === NARRATOR_KEY;
    const name = narrator ? "Narrator" : decision.canonicalName || proposal.label;
    const anchor = decision.primaryLabel || proposal.label;
    const key = narrator ? NARRATOR_KEY : `${decision.category}:${comparisonKey(anchor)}`;
    const dossier = dossierByLabel.get(proposal.label);
    const group = groups.get(key) ?? {
      key, name, category: decision.category, labels: [], proposals: [], dossiers: [],
      occurrenceCount: 0, needsReview: false,
    };
    group.labels.push(proposal.label);
    group.proposals.push(proposal);
    if (dossier) group.dossiers.push(dossier);
    group.occurrenceCount += dossier?.occurrenceCount ?? 0;
    group.needsReview ||= confirmationLabels.has(proposal.label) && !resolvedLabels.includes(proposal.label);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const votes = new Map<string, number>();
    for (const label of group.labels) {
      const candidate = decisions[label]?.primaryLabel;
      if (candidate && group.labels.includes(candidate)) votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
    }
    const primaryLabel = [...group.labels].sort((left, right) =>
      (votes.get(right) ?? 0) - (votes.get(left) ?? 0)
        || (dossierByLabel.get(right)?.occurrenceCount ?? 0) - (dossierByLabel.get(left)?.occurrenceCount ?? 0)
        || left.localeCompare(right),
    )[0];
    const labels = [primaryLabel, ...group.labels.filter((label) => label !== primaryLabel)];
    const unresolved = group.proposals.filter(
      (proposal) => confirmationLabels.has(proposal.label) && !resolvedLabels.includes(proposal.label),
    );
    const autoGrouped = group.needsReview && labels.length > 1 && unresolved.some((proposal) =>
      proposal.aliases?.some((alias) => labels.includes(alias)),
    );
    const qwenReview = unresolved.some((proposal) =>
      Boolean(proposal.competingLabels?.length) || proposal.category !== "character",
    ) || (group.needsReview && !autoGrouped);
    const hasSuggestions = group.labels.some((label) => {
      const proposal = group.proposals.find((row) => row.label === label);
      const dossier = dossierByLabel.get(label);
      return [...(proposal?.aliases ?? []), ...(proposal?.competingLabels ?? []), ...(dossier?.fuzzyCandidates ?? [])]
        .some((candidate) => availableLabels.has(candidate) && !group.labels.includes(candidate));
    });
    const advisoryReview = !group.needsReview && (hasSuggestions || group.proposals.some(
      (proposal) => proposal.reviewRequired && !confirmationLabels.has(proposal.label),
    ));
    return {
      ...group,
      primaryLabel,
      labels,
      autoGrouped,
      qwenReview,
      hasSuggestions,
      advisoryReview,
    };
  }).sort((left, right) =>
    Number(right.needsReview) - Number(left.needsReview)
      || Number(right.advisoryReview) - Number(left.advisoryReview)
      || right.occurrenceCount - left.occurrenceCount || left.name.localeCompare(right.name),
  );
}

function tileSymbol(group: CastGroup) {
  if (group.autoGrouped) return "↔";
  if (group.qwenReview || group.needsReview) return "?";
  const words = group.name.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase() || "—";
}

function exampleLine(dossier?: CastDossier) {
  const row = dossier?.examples?.[0];
  return row?.sourceText ?? row?.source ?? row?.text ?? "No source line available";
}

function useDragAutoScroll(active: boolean) {
  const [direction, setDirection] = useState<"up" | "down">();
  const speedRef = useRef(0);
  const frameRef = useRef<number | undefined>(undefined);
  const previousFrameTimeRef = useRef<number | undefined>(undefined);

  const scrollFrame = useCallback((timestamp: number) => {
    const previousTimestamp = previousFrameTimeRef.current;
    previousFrameTimeRef.current = timestamp;
    if (previousTimestamp !== undefined) {
      const elapsedSeconds = Math.min(timestamp - previousTimestamp, 50) / 1000;
      window.scrollBy({ top: speedRef.current * elapsedSeconds, behavior: "auto" });
    }
    frameRef.current = window.requestAnimationFrame(scrollFrame);
  }, []);

  const stop = useCallback(() => {
    if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
    previousFrameTimeRef.current = undefined;
    speedRef.current = 0;
    setDirection(undefined);
  }, []);

  const updatePointer = useCallback((clientY: number) => {
    if (!active) return;
    const viewportHeight = window.innerHeight;
    const topbarBottom = Math.max(
      document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 0,
      0,
    );
    const topBoundary = Math.min(topbarBottom + DRAG_SCROLL_EDGE_PX, viewportHeight / 2);
    const bottomBoundary = Math.max(viewportHeight - DRAG_SCROLL_EDGE_PX, viewportHeight / 2);
    let nextDirection: "up" | "down" | undefined;
    let strength = 0;

    if (clientY < topBoundary) {
      nextDirection = "up";
      strength = clientY <= topbarBottom
        ? 1
        : (topBoundary - clientY) / Math.max(topBoundary - topbarBottom, 1);
    } else if (clientY > bottomBoundary) {
      nextDirection = "down";
      strength = (clientY - bottomBoundary) / Math.max(viewportHeight - bottomBoundary, 1);
    }

    if (!nextDirection) {
      stop();
      return;
    }

    const progressiveSpeed = DRAG_SCROLL_MIN_PX_PER_SECOND
      + (DRAG_SCROLL_MAX_PX_PER_SECOND - DRAG_SCROLL_MIN_PX_PER_SECOND)
        * Math.min(Math.max(strength, 0), 1) ** 2;
    speedRef.current = nextDirection === "up" ? -progressiveSpeed : progressiveSpeed;
    setDirection(nextDirection);
    if (frameRef.current === undefined) {
      frameRef.current = window.requestAnimationFrame(scrollFrame);
    }
  }, [active, scrollFrame, stop]);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    const trackPointer = (event: globalThis.DragEvent) => updatePointer(event.clientY);
    window.addEventListener("dragover", trackPointer);
    return () => {
      window.removeEventListener("dragover", trackPointer);
      stop();
    };
  }, [active, stop, updatePointer]);

  return { direction, stop, updatePointer };
}

export function CastIdentityReview({
  cast, decisions, setDecisions, resolvedLabels, setResolvedLabels, voiceModels, voiceModel,
  language, onVoiceModelChange, onLanguageChange, onReclassify, hideVoiceModel, hideVoiceSettings,
}: Props) {
  const { t } = useTranslation();
  const allGroups = useMemo(
    () => makeGroups(cast, decisions, resolvedLabels),
    [cast, decisions, resolvedLabels],
  );
  const narratorAssignments = allGroups.find((group) => group.key === NARRATOR_KEY);
  const groups = allGroups.filter((group) => group.key !== NARRATOR_KEY);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const largeCollection = groups.length > 12;
  const visibleGroups = largeCollection ? groups.filter((group) => collectionMatches(collectionQuery, [group.name, ...group.labels]) && (collectionFilter === "all" || (collectionFilter === "required" ? group.needsReview : collectionFilter === "suggested" ? group.advisoryReview : !group.needsReview && !group.advisoryReview))) : groups;
  const [inspectedLabel, setInspectedLabel] = useState<string>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorClosing, setInspectorClosing] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [labelSearch, setLabelSearch] = useState("");
  const [draggedGroupKey, setDraggedGroupKey] = useState<string>();
  const [dropTargetKey, setDropTargetKey] = useState<string>();
  const [mergeSuccessKey, setMergeSuccessKey] = useState<string>();
  const [mergeUndo, setMergeUndo] = useState<{
    message: string;
    decisions: Record<string, IdentityDecision>;
    resolvedLabels: string[];
  }>();
  const closeTimer = useRef<number | undefined>(undefined);
  const mergeTimer = useRef<number | undefined>(undefined);
  const undoTimer = useRef<number | undefined>(undefined);
  const focusAfterClose = useRef<string | undefined>(undefined);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dragAutoScroll = useDragAutoScroll(Boolean(draggedGroupKey));
  const inspectingNarrator = inspectorOpen && inspectedLabel === NARRATOR_KEY;
  const active = inspectorOpen && !inspectingNarrator
    ? groups.find((group) => group.labels.includes(inspectedLabel ?? ""))
    : undefined;
  const selectedModel = voiceModels.find((row) => row.id === voiceModel);
  const dossierByLabel = new Map(cast.dossiers.map((row) => [row.label, row]));
  const confirmationLabels = strongConfirmationLabelsForCast(cast, decisions);

  useEffect(() => () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    if (mergeTimer.current !== undefined) window.clearTimeout(mergeTimer.current);
    if (undoTimer.current !== undefined) window.clearTimeout(undoTimer.current);
  }, []);

  function finishInspectorClose() {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setInspectorOpen(false);
    setInspectorClosing(false);
  }

  useEffect(() => {
    if (inspectorOpen || !focusAfterClose.current) return;
    if (focusAfterClose.current) {
      const target = tileRefs.current[focusAfterClose.current] ?? workbenchRef.current?.querySelector<HTMLInputElement>(".collection-search input");
      target?.focus();
    }
    focusAfterClose.current = undefined;
  }, [inspectorOpen]);

  function closeInspectorAfterDecision() {
    setInspectorClosing(true);
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(finishInspectorClose, 260);
  }

  function openInspector(label: string) {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    setInspectorClosing(false);
    setInspectedLabel(label);
    setInspectorOpen(true);
    setRenameDraft("");
    setLabelSearch("");
  }

  function updateLabels(labels: string[], update: (decision: IdentityDecision) => IdentityDecision) {
    setDecisions((current) => {
      const next = { ...current };
      for (const label of labels) {
        const proposal = cast.proposals.find((row) => row.label === label);
        if (proposal) next[label] = update(current[label] ?? fallbackDecision(proposal));
      }
      return next;
    });
  }

  function resolve(labels: string[]) {
    const flagged = new Set(cast.proposals.filter((row) => row.reviewRequired).map((row) => row.label));
    setResolvedLabels((current) => [...new Set([...current, ...labels.filter((label) => flagged.has(label))])]);
  }

  function pulse(key: string) {
    setMergeSuccessKey(key);
    if (mergeTimer.current !== undefined) window.clearTimeout(mergeTimer.current);
    mergeTimer.current = window.setTimeout(() => setMergeSuccessKey(undefined), 620);
  }

  function offerMergeUndo(source: string, target: string) {
    setMergeUndo({
      message: t("Merged {{source}} into {{target}}.", { source, target }),
      decisions,
      resolvedLabels,
    });
    if (undoTimer.current !== undefined) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setMergeUndo(undefined), 6000);
  }

  function undoLastMerge() {
    if (!mergeUndo) return;
    setDecisions(mergeUndo.decisions);
    setResolvedLabels(mergeUndo.resolvedLabels);
    setMergeUndo(undefined);
    if (undoTimer.current !== undefined) window.clearTimeout(undoTimer.current);
    undoTimer.current = undefined;
  }

  function mergeGroup(source: CastGroup, target: CastGroup) {
    if (source.key === target.key) return;
    offerMergeUndo(source.name, target.name);
    updateLabels(source.labels, (decision) => ({
      ...decision,
      category: target.category,
      canonicalName: target.name,
      aliases: [],
      primaryLabel: target.primaryLabel,
    }));
    resolve([...source.labels, ...target.labels]);
    pulse(target.key);
  }

  function assignGroupToNarrator(source: CastGroup) {
    offerMergeUndo(source.name, t("Narrator"));
    updateLabels(source.labels, (decision) => ({
      ...decision,
      category: NARRATOR_KEY,
      canonicalName: "",
      aliases: [],
      primaryLabel: NARRATOR_KEY,
    }));
    resolve(source.labels);
    pulse(NARRATOR_KEY);
  }

  function attachLabel(label: string) {
    if (!active) return;
    const owner = groups.find((group) => group.labels.includes(label));
    if (owner?.primaryLabel === label && owner.labels.length > 1) {
      mergeGroup(owner, active);
    } else {
      updateLabels([label], (decision) => ({
        ...decision,
        category: active.category,
        canonicalName: active.name,
        aliases: [],
        primaryLabel: active.primaryLabel,
      }));
      resolve([label, ...active.labels]);
      pulse(active.key);
    }
    setLabelSearch("");
  }

  function detachLabel(label: string) {
    if (!active || label === active.primaryLabel) return;
    const proposal = cast.proposals.find((row) => row.label === label);
    updateLabels([label], (decision) => ({
      ...decision,
      category: proposal?.category === "group" ? "group" : "character",
      canonicalName: label,
      aliases: [],
      primaryLabel: label,
    }));
    resolve([label, ...active.labels]);
    setInspectedLabel(active.primaryLabel);
  }

  function restoreNarratorLabel(label: string) {
    const proposal = cast.proposals.find((row) => row.label === label);
    updateLabels([label], (decision) => ({
      ...decision,
      category: proposal?.category === "group" ? "group" : "character",
      canonicalName: label,
      aliases: [],
      primaryLabel: label,
    }));
    resolve([label]);
    pulse(label);
  }

  function renameActive() {
    const name = renameDraft.trim();
    if (!active || !name) return;
    updateLabels(active.labels, (decision) => ({ ...decision, canonicalName: name, aliases: [] }));
    resolve(active.labels);
    setRenameDraft("");
  }

  function changeCategory(category: string) {
    if (!active) return;
    updateLabels(active.labels, (decision) => ({
      ...decision,
      category,
      canonicalName: category === "editorial" || category === "unresolved-marker"
        ? ""
        : decision.canonicalName || active.name,
      aliases: [],
    }));
    resolve(active.labels);
  }

  function confirmMaterialDecision() {
    if (!active) return;
    const flagged = active.labels.filter((label) => confirmationLabels.includes(label));
    focusAfterClose.current = active.primaryLabel;
    resolve(flagged);
    closeInspectorAfterDecision();
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, group: CastGroup) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", group.key);
    setDraggedGroupKey(group.key);
    dragAutoScroll.updatePointer(event.clientY);
  }

  function dragOver(event: DragEvent<HTMLButtonElement>, key: string) {
    if (!draggedGroupKey || draggedGroupKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetKey(key);
  }

  function dropOn(event: DragEvent<HTMLButtonElement>, target?: CastGroup) {
    event.preventDefault();
    event.stopPropagation();
    const sourceKey = draggedGroupKey || event.dataTransfer.getData("text/plain");
    const source = groups.find((group) => group.key === sourceKey);
    if (source) {
      if (target) mergeGroup(source, target);
      else assignGroupToNarrator(source);
    }
    setDraggedGroupKey(undefined);
    setDropTargetKey(undefined);
    dragAutoScroll.stop();
  }

  const outsideLabels = active
    ? cast.proposals.filter((proposal) => !active.labels.includes(proposal.label)
      && decisions[proposal.label]?.category !== NARRATOR_KEY)
    : [];
  const query = searchTokens(labelSearch);
  const searchResults = query.length ? outsideLabels.filter((proposal) => {
    const owner = groups.find((group) => group.labels.includes(proposal.label));
    const searchable = searchTokens(`${proposal.label} ${owner?.name ?? ""} ${exampleLine(dossierByLabel.get(proposal.label))}`);
    return query.every((token) => searchable.some((word) => word.includes(token)));
  }).slice(0, 8) : [];
  const suggestedLabels = active ? [...new Set(active.labels.flatMap((label) => {
    const proposal = cast.proposals.find((row) => row.label === label);
    const dossier = dossierByLabel.get(label);
    return [...(proposal?.aliases ?? []), ...(proposal?.competingLabels ?? []), ...(dossier?.fuzzyCandidates ?? [])];
  }))].filter((label) => cast.proposals.some((proposal) => proposal.label === label)
    && !active.labels.includes(label) && decisions[label]?.category !== NARRATOR_KEY) : [];

  return <div ref={workbenchRef} className="cast-workbench">
    {(onReclassify || !hideVoiceSettings) && <div className="cast-toolbar">
      <div className="cast-toolbar-actions">
        {onReclassify && <button type="button" className="ghost compact danger-subtle cast-reclassify-action" onClick={onReclassify}>{t("Reclassify from Dialogue")}</button>}
        {!hideVoiceSettings && <DismissibleDetails>
          <summary>{flags[language] ?? "🌐"} {language ? t(language) : t("Choose language")}{!hideVoiceModel && <> · {selectedModel?.label ?? t("Choose voice model")}</>}</summary>
          <div className="cast-audio-settings">
            {!hideVoiceModel && <label>{t("Voice model")}<select aria-label={t("Voice model")} value={voiceModel} onChange={(event) => onVoiceModelChange(event.target.value)}>{voiceModels.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
            <LanguageFlags languages={selectedModel?.supportedLanguages ?? []} language={language} onChange={onLanguageChange} />
          </div>
        </DismissibleDetails>}
      </div>
    </div>}

    {largeCollection && <CollectionToolbar query={collectionQuery} onQueryChange={setCollectionQuery} filter={collectionFilter} onFilterChange={setCollectionFilter} searchLabel={t("Search cast")} filterLabel={t("Show cast")} countLabel={t("{{shown}} of {{total}} cast members shown", { shown: visibleGroups.length, total: groups.length })} clearLabel={t("Clear")} filters={[
      { value: "all", label: t("All") }, { value: "required", label: t("Required") }, { value: "suggested", label: t("Suggested") }, { value: "ready", label: t("Ready") },
    ]} />}
    {largeCollection && !visibleGroups.length && <div className="collection-empty"><b>{t("No cast members match these filters.")}</b><span>{t("Clear the search and filter to see the whole cast.")}</span><button type="button" className="ghost" onClick={() => { setCollectionQuery(""); setCollectionFilter("all"); }}>{t("Clear")}</button></div>}
    <section className="cast-board" aria-label={t("Cast members")}>
      <CastRosterCard
        name={t("Narrator")} symbol="♬"
        detail={t("Normal book prose")}
        portraitClassName="cast-narrator-tile"
        cardClassName={`cast-narrator-tile ${dropTargetKey === NARRATOR_KEY ? "drop-target" : ""} ${mergeSuccessKey === NARRATOR_KEY ? "merge-success" : ""}`}
        inspectRef={(element) => { tileRefs.current[NARRATOR_KEY] = element; }}
        inspectProps={{ "aria-label": t("Inspect Narrator"), onClick: () => openInspector(NARRATOR_KEY), onDragOver: (event) => dragOver(event, NARRATOR_KEY), onDragLeave: () => setDropTargetKey(undefined), onDrop: (event) => dropOn(event) }}
      />
      {visibleGroups.map((group) => { const suspicious = group.needsReview && group.labels.length > 3; return <CastRosterCard
        key={group.key}
        name={group.name} symbol={suspicious ? "!" : tileSymbol(group)}
        portraitClassName={`portrait-tone-${groups.indexOf(group) % 4}`}
        detail={t(group.occurrenceCount === 1 ? "{{count}} line" : "{{count}} lines", { count: group.occurrenceCount })}
        badge={<>{group.needsReview ? <span className="cast-review-badge required">{t("Must review")}</span> : group.advisoryReview ? <span className="cast-review-badge advisory">{t("Should review")}</span> : null}{group.labels.some((label) => cast.previousVoiceMatches?.[label]) && <span className="previous-book-badge">{t("From prior book")}</span>}</>}
        cardClassName={`${group.labels.some((label) => cast.previousVoiceMatches?.[label]) ? "previous-book-match" : ""} ${group.needsReview ? "needs-review" : group.advisoryReview ? "has-suggestions" : "ready"} ${group.autoGrouped ? "auto-grouped" : ""} ${group.qwenReview ? "qwen-review" : ""} ${suspicious ? "suspicious-merge" : ""} ${active?.key === group.key ? "selected" : ""} ${draggedGroupKey === group.key ? "dragging" : ""} ${dropTargetKey === group.key ? "drop-target" : ""} ${mergeSuccessKey === group.key ? "merge-success" : ""}`}
        inspectRef={(element) => { tileRefs.current[group.primaryLabel] = element; }}
        inspectProps={{ draggable: true, "aria-label": t("Inspect {{name}}", { name: group.name }), onClick: () => openInspector(group.primaryLabel), onDragStart: (event) => startDrag(event, group), onDragEnd: () => { setDraggedGroupKey(undefined); setDropTargetKey(undefined); dragAutoScroll.stop(); }, onDragOver: (event) => dragOver(event, group.key), onDragLeave: () => setDropTargetKey(undefined), onDrop: (event) => dropOn(event, group) }}
      />; })}
    </section>

    {dragAutoScroll.direction && <div className={`cast-drag-scroll-cue ${dragAutoScroll.direction}`} aria-hidden="true"><span>{dragAutoScroll.direction === "up" ? `↑ ${t("Scroll up")}` : `↓ ${t("Scroll down")}`}</span></div>}
    {mergeUndo && <div className="cast-merge-undo" role="status"><span>{mergeUndo.message}</span><button type="button" onClick={undoLastMerge}>{t("Undo")}</button></div>}

    {inspectingNarrator && <InspectorShell label={t("Inspect Narrator")} className="identity-inspector" closing={inspectorClosing} onClose={() => setInspectorOpen(false)} onClosed={finishInspectorClose}>
      <header className="cast-inspector-head">
        <div><span className="cast-status-dot ready" /> <small>{t("Always available")}</small><h2>{t("Narrator")}</h2>{(narratorAssignments?.occurrenceCount ?? 0) > 0 && <p>{t("Reads all prose plus {{count}} dialogue lines reassigned here.", { count: narratorAssignments?.occurrenceCount ?? 0 })}</p>}</div>
        <button type="button" className="cast-inspector-close" aria-label={t("Close cast member")} onClick={() => setInspectorOpen(false)}>×</button>
      </header>
      <div className="cast-inspector-grid narrator-inspector-grid">
        <aside className="cast-member-controls">
          <section className="narrator-rule"><b>{t("Narrator routing")}</b><small>{t("Drag a cast member onto Narrator to use the narrator voice. Narrator cannot be merged into another character. Choose the narrator voice in the next step.")}</small></section>
        </aside>
        <div className="cast-aliases-and-lines">
          <div className="cast-section-heading"><div><small>{t("Dialogue fallback")}</small><h3>{t("Labels assigned to Narrator")}</h3></div>{(narratorAssignments?.labels.length ?? 0) > 0 && <span>{t("{{count}} assigned", { count: narratorAssignments?.labels.length ?? 0 })}</span>}</div>
          <article className="cast-alias-card narrator-primary-label"><header><div><b>{t("Narrator")}</b><small>{t("Normal book prose")}</small></div><span className="primary-label-badge">{t("Permanent primary")}</span></header><p className="cast-reason">{t("This identity always remains the Narrator and cannot be dragged or replaced.")}</p></article>
          {narratorAssignments?.labels.map((label) => <EvidenceCard key={label} label={label} dossier={dossierByLabel.get(label)} proposal={cast.proposals.find((row) => row.label === label)} action={<button type="button" className="ghost compact" onClick={() => restoreNarratorLabel(label)}>{t("Pop out to cast")}</button>} />)}
        </div>
      </div>
    </InspectorShell>}

    {active && <InspectorShell label={t("Inspect {{name}}", { name: active.name })} className="identity-inspector" closing={inspectorClosing} onClose={() => setInspectorOpen(false)} onClosed={finishInspectorClose}>
      <header className="cast-inspector-head">
        <div><span className={`cast-status-dot ${active.needsReview ? "needs-review" : active.advisoryReview ? "has-suggestions" : "ready"}`} /> <small>{t(active.needsReview ? "Confirmation required" : active.advisoryReview ? "Should review" : "Ready")}</small><h2>{active.name}</h2><p>{t(`${active.occurrenceCount === 1 ? "{{lines}} spoken line" : "{{lines}} spoken lines"} across ${active.labels.length === 1 ? "{{labels}} source label" : "{{labels}} source labels"}.`, { lines: active.occurrenceCount, labels: active.labels.length })}</p></div>
        <div className="cast-inspector-actions">{active.needsReview && <button type="button" className="primary" onClick={confirmMaterialDecision}>{t(active.labels.length > 1 ? "Confirm grouping" : "Confirm classification")}</button>}<button type="button" className="cast-inspector-close" aria-label={t("Close cast member")} onClick={() => setInspectorOpen(false)}>×</button></div>
      </header>
      {(active.needsReview || active.advisoryReview) && <p className={`cast-review-explanation ${active.needsReview ? "required" : "advisory"}`}><strong>{t(active.needsReview ? "Required before continuing" : "Optional check")}</strong><span>{t(active.needsReview ? "Confirm this identity before moving to Voices." : "Compare the source labels if this looks uncertain. You can continue without changing it.")}</span></p>}
      <div className="cast-inspector-grid">
        <aside className="cast-member-controls">
          <section><h3>{t("Cast identity")}</h3><label>{t("Category")}<select aria-label={t("Cast member category")} value={active.category} onChange={(event) => changeCategory(event.target.value)}><option value="character">{t("Character")}</option><option value="group">{t("Group")}</option><option value="editorial">{t("Editorial")}</option><option value="unresolved-marker">{t("Open marker")}</option></select></label>{!(["editorial", "unresolved-marker"].includes(active.category)) && <form aria-label={t("Rename cast member")} onSubmit={(event) => { event.preventDefault(); renameActive(); }}><label>{t("Rename cast member")}<div className="joined-control"><input aria-label={t("New cast member name")} value={renameDraft} placeholder={active.name} onChange={(event) => setRenameDraft(event.target.value)} /><button type="submit" disabled={!renameDraft.trim() || renameDraft.trim() === active.name}>{t("Rename")}</button></div><small>{t("Changes the cast member name without rewriting the book’s labels.")}</small></label></form>}</section>
          <section><h3>{t("Attach a source label")}</h3><label>{t("Search")}<input type="search" aria-label={t("Search source labels")} value={labelSearch} placeholder={t("Name or spoken line…")} onChange={(event) => setLabelSearch(event.target.value)} /></label>{!query.length && <small>{t("Search {{count}} available labels by name or spoken line.", { count: outsideLabels.length })}</small>}<div className="cast-label-results" role="list" aria-label={t("Source label search results")}>{searchResults.map((proposal) => { const owner = groups.find((group) => group.labels.includes(proposal.label)); return <article key={proposal.label} role="listitem"><div><b>{proposal.label}</b><small>{t("Currently {{owner}}", { owner: owner?.name ?? t("unassigned") })}</small><q>{exampleLine(dossierByLabel.get(proposal.label))}</q></div><button type="button" onClick={() => attachLabel(proposal.label)}>{owner?.primaryLabel === proposal.label && owner.labels.length > 1 ? t("Merge {{name}}", { name: owner.name }) : t("Attach")}</button></article>; })}</div>{query.length > 0 && outsideLabels.length > searchResults.length && <small>{t("Showing the first {{count}} matches.", { count: searchResults.length })}</small>}</section>
        </aside>
        <div className="cast-aliases-and-lines">
          <div className="cast-section-heading"><div><small>{t("Source evidence")}</small><h3>{t("Source labels")}</h3></div><span>{t("{{count}} attached", { count: active.labels.length })}</span></div>
          {active.labels.map((label) => <EvidenceCard key={label} label={label} dossier={dossierByLabel.get(label)} proposal={cast.proposals.find((row) => row.label === label)} primary={label === active.primaryLabel} action={label !== active.primaryLabel ? <button type="button" className="ghost compact" onClick={() => detachLabel(label)}>{t("Detach")}</button> : undefined} />)}
          {suggestedLabels.length > 0 && <details key={active.key} className="cast-match-panel" open><summary><span><small>{t("Across this cast member")}</small><b>{t("Suggested matches")}</b></span><strong>{suggestedLabels.length}</strong></summary><div className="cast-label-results">{suggestedLabels.map((label) => { const owner = groups.find((group) => group.labels.includes(label)); return <article key={label}><div><b>{label}</b><small>{t("Currently {{owner}}", { owner: owner?.name ?? t("unassigned") })}</small><q>{exampleLine(dossierByLabel.get(label))}</q></div><button type="button" onClick={() => attachLabel(label)}>{owner?.primaryLabel === label && owner.labels.length > 1 ? t("Merge {{name}}", { name: owner.name }) : t("Attach")}</button></article>; })}</div></details>}
        </div>
      </div>
    </InspectorShell>}
  </div>;
}


function EvidenceCard({ label, dossier, proposal, primary = false, action }: { label: string; dossier?: CastDossier; proposal?: CastProposal; primary?: boolean; action?: React.ReactNode }) {
  const { t } = useTranslation();
  return <article className="cast-alias-card">
    <header><div><b>{label}</b><small>{t("{{count}} lines", { count: dossier?.occurrenceCount ?? 0 })}</small></div><div>{primary && <span className="primary-label-badge">{t("Primary label")}</span>}{action}</div></header>
    {proposal?.reason && <p className="cast-reason">{t(userFacingDetail(proposal.reason, "Check the examples before deciding whether these names belong together."))}</p>}
    <div className="cast-line-list">{dossier?.examples?.slice(0, 3).map((row, index) => <blockquote key={index}><small>{row.page ? t("Page {{page}}", { page: row.page }) : t("Example {{number}}", { number: index + 1 })}</small>{row.contextBefore && <p>{row.contextBefore}</p>}<mark>{row.sourceText ?? row.source ?? row.text ?? t("No source line available")}</mark>{row.contextAfter && <p>{row.contextAfter}</p>}</blockquote>)}</div>
  </article>;
}
