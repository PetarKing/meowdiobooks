import { SourceExcerpt } from "./SourceExcerpt";
import { DialogBackdrop } from "./DialogBackdrop";
import { DialogSurface } from "./DialogSurface";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DialogueArtifact, DialogueExample, DialogueReaderAssignment } from "../api/contracts";
import { dialogueOutcomeCounts } from "../workflow/dialogue";

export type DialogueCorrectionAction = "speaker" | "narrator";

export type DialogueCorrectionDecision = {
  spanId: string;
  action: DialogueCorrectionAction;
  speakerLabel?: string;
  provenance: "user";
};

type DialogueView = "overview" | "review" | "all";
type DialogueFilter = "all" | "character" | "reviewed" | "review" | "not-dialogue";
type DialogueCategory = "character" | "suggested" | "unsure" | "narrator" | "not-dialogue";
type ReviewRow = { row: DialogueExample; category: DialogueCategory };

type Props = {
  result: DialogueArtifact;
  busy: boolean;
  initialDecisions?: DialogueCorrectionDecision[];
  requireChanges?: boolean;
  onChangeStrategy: () => void;
  onAccept: (decisions: DialogueCorrectionDecision[]) => void;
};

export function DialogueComposition({ dialogue, compact = false }: { dialogue: DialogueArtifact; compact?: boolean }) {
  const { t } = useTranslation();
  const counts = dialogueOutcomeCounts(dialogue);
  const denominator = Math.max(1, counts.total);
  const parts = [
    { key: "known", count: counts.known, label: "Known speakers" },
    { key: "ai", count: counts.ai, label: "AI assigned" },
    { key: "changed", count: counts.user, label: "Changed by you" },
    { key: "fallback", count: counts.narrator, label: compact ? "Narrator" : "Narrator for now" },
  ].filter(({ count }) => count > 0);
  return <div className={`dialogue-composition-summary ${compact ? "compact" : ""}`}>
    <strong>{t("{{count}} dialogue lines", { count: counts.total })}</strong>
    <div className="dialogue-book-composition" role="img" aria-label={t("Dialogue assignment summary")}>
      {parts.map(({ key, count }) => <i className={key} key={key} style={{ width: `${count / denominator * 100}%` }} />)}
    </div>
    <div className="dialogue-reader-legend" role="group" aria-label={t("Reader assignment legend")}>
      {parts.map(({ key, count, label }) => <span className={key} key={key}><b>{count}</b>{t(label)}</span>)}
    </div>
  </div>;
}

const pageSize = 1;
const overviewReaderStep = 4;
const filterOptions: Array<[DialogueFilter, string]> = [
  ["all", "All"],
  ["character", "AI chosen"],
  ["reviewed", "Reviewed"],
  ["review", "Needs review"],
  ["not-dialogue", "Not dialogue"],
];

export function DialogueResultReview({ result, busy, initialDecisions = [], requireChanges = false, onChangeStrategy, onAccept }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<DialogueView>(result.examples.some((row) => needsAttention(row) && !initialDecisions.some(({ spanId }) => spanId === row.spanId)) ? "review" : "overview");
  const [filter, setFilter] = useState<DialogueFilter>("all");
  const [page, setPage] = useState(0);
  const [readerLimit, setReaderLimit] = useState(overviewReaderStep);
  const [reviewIndex, setReviewIndex] = useState(() => Math.max(0,
    result.examples.filter(needsAttention).sort((a, b) => reviewPriority(a) - reviewPriority(b))
      .findIndex((row) => !initialDecisions.some(({ spanId }) => spanId === row.spanId)),
  ));
  const [checkedSpanIds, setCheckedSpanIds] = useState<Record<string, boolean>>(() => Object.fromEntries(initialDecisions.map(({ spanId }) => [spanId, true])));
  const [editingSpanId, setEditingSpanId] = useState<string>();
  const [draftSpeaker, setDraftSpeaker] = useState("");
  const [activeSpeakerOption, setActiveSpeakerOption] = useState(0);
  const [corrections, setCorrections] = useState<Record<string, DialogueCorrectionDecision>>(() => correctionRecord(initialDecisions));
  const [bulkUndo, setBulkUndo] = useState<{ corrections: Record<string, DialogueCorrectionDecision>; checked: Record<string, boolean> }>();
  const [extraReaderBySpan, setExtraReaderBySpan] = useState<Record<string, string>>({});
  const characterEditor = useRef<HTMLDivElement>(null);
  const pendingReaderFocus = useRef<{ spanId: string; reader: string } | undefined>(undefined);
  const readerButtons = useRef<Record<string, Record<string, HTMLButtonElement | null>>>({});
  const [expandedContext, setExpandedContext] = useState<Record<string, boolean>>({});
  const [confirmStrategy, setConfirmStrategy] = useState(false);
  const cancelStrategyRef = useRef<HTMLButtonElement>(null);
  const strategyTriggerRef = useRef<HTMLButtonElement>(null);
  const strategyTitleId = useId();
  const strategyDescriptionId = useId();
  const reviewHeading = useRef<HTMLDivElement>(null);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterDecision = useRef(false);
  const characterTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const speakerFieldId = useId();
  const speakerOptionsId = useId();
  const speakerOptions = useMemo(
    () => [...new Set((result.speakerOptions ?? []).map((label) => label.trim()).filter((label) => label && !/^\?+$/.test(label)))],
    [result.speakerOptions],
  );

  const rows = useMemo(() => result.examples.map((row) => ({ row, category: originalCategory(row) })), [result.examples]);
  const reviewRows = useMemo(
    () => rows.filter(({ row }) => needsAttention(row)).sort((left, right) => reviewPriority(left.row) - reviewPriority(right.row)),
    [rows],
  );
  function matchesFilter({ row, category }: ReviewRow, value: DialogueFilter) {
    const checked = Boolean(checkedSpanIds[row.spanId] || corrections[row.spanId]);
    if (value === "all") return true;
    if (value === "review") return needsAttention(row) && !checked;
    if (value === "reviewed") return checked;
    if (value === "character") return category === "character" && !corrections[row.spanId];
    return category === "not-dialogue" && !corrections[row.spanId];
  }
  const counts = Object.fromEntries(filterOptions.map(([value]) => [value, rows.filter((row) => matchesFilter(row, value)).length])) as Record<DialogueFilter, number>;
  const readerAssignments = useMemo(
    () => adjustedReaderAssignments(result.readerAssignments ?? fallbackReaderAssignments(result.examples), result.examples, corrections),
    [corrections, result.examples, result.readerAssignments],
  );
  const largestReaderTotal = Math.max(1, ...readerAssignments.map((assignment) => assignment.total));
  const orderedReaderAssignments = useMemo(() => prioritizeNarrator(readerAssignments), [readerAssignments]);
  const visibleReaderAssignments = orderedReaderAssignments.slice(0, readerLimit);
  const hiddenReaderCount = Math.max(0, orderedReaderAssignments.length - visibleReaderAssignments.length);
  const exampleOrder = new Map(result.examples.map((row, index) => [row.spanId, index]));
  const orderedDecisions = Object.values(corrections).sort((left, right) =>
    (exampleOrder.get(left.spanId) ?? Number.MAX_SAFE_INTEGER) - (exampleOrder.get(right.spanId) ?? Number.MAX_SAFE_INTEGER)
    || left.spanId.localeCompare(right.spanId),
  );
  const decisionsChanged = correctionSignature(orderedDecisions) !== correctionSignature(initialDecisions);

  const filteredRows = rows.filter((row) => matchesFilter(row, filter));
  const pageCount = Math.ceil(filteredRows.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleRows = filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const currentReviewIndex = Math.min(reviewIndex, Math.max(0, reviewRows.length - 1));
  const currentReviewRow = reviewRows[currentReviewIndex];
  const checkedReviewCount = reviewRows.filter(({ row }) => checkedSpanIds[row.spanId] || corrections[row.spanId]).length;
  const remainingReviewCount = reviewRows.length - checkedReviewCount;
  const compositionCounts = dialogueOutcomeCounts({ ...result, readerAssignments });
  const legend = [
    { key: "known", count: compositionCounts.known, label: "Known speakers" },
    { key: "ai", count: compositionCounts.ai, label: "AI assigned" },
    { key: "changed", count: compositionCounts.user, label: "Changed by you" },
    { key: "fallback", count: compositionCounts.narrator, label: "Narrator" },
  ].filter(({ count }) => count > 0);

  useEffect(() => {
    if (!focusAfterDecision.current) return;
    focusAfterDecision.current = false;
    (view === "overview" ? overviewHeading.current : reviewHeading.current)?.focus();
  }, [view, currentReviewIndex, checkedReviewCount]);

  useEffect(() => {
    const pending = pendingReaderFocus.current;
    if (!pending) return;
    pendingReaderFocus.current = undefined;
    if (view === "review" && currentReviewRow?.row.spanId !== pending.spanId) return;
    (readerButtons.current[pending.spanId]?.[pending.reader] ?? overviewHeading.current)?.focus();
  }, [extraReaderBySpan, corrections, view, currentReviewRow]);

  useEffect(() => {
    if (!editingSpanId) return;
    function dismissOutside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (characterEditor.current?.contains(event.target) || characterTriggers.current[editingSpanId!]?.contains(event.target)) return;
      setEditingSpanId(undefined);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [editingSpanId]);

  function closeCharacterEditor() {
    if (editingSpanId) characterTriggers.current[editingSpanId]?.focus();
    setEditingSpanId(undefined);
  }

  function changeView(next: DialogueView) {
    setView(next);
    focusAfterDecision.current = true;
    setEditingSpanId(undefined);
    if (next === "all") {
      setFilter("all");
      setPage(0);
    }
  }

  function changeFilter(next: DialogueFilter) {
    setFilter(next);
    setPage(0);
    setEditingSpanId(undefined);
  }

  function beginCharacterCorrection(row: DialogueExample, speakerLabel = "") {
    setDraftSpeaker(usableSpeakerLabel(speakerLabel));
    setActiveSpeakerOption(0);
    setEditingSpanId(row.spanId);
  }

  function applyQuickDecision(row: DialogueExample, action: DialogueCorrectionAction, speakerLabel?: string) {
    setBulkUndo(undefined);
    if (editingSpanId === row.spanId) characterTriggers.current[row.spanId]?.focus();
    const originalAiChoice = row.speakerStatus === "ai" && usableSpeakerLabel(row.speakerLabel)
      && (action === "speaker" ? speakerLabel?.trim() === row.speakerLabel : row.speakerLabel === "Narrator")
      || action === "narrator" && row.origin === "qwen:not-vocalisation";
    setCorrections((current) => {
      const next = { ...current };
      if (originalAiChoice) delete next[row.spanId];
      else next[row.spanId] = {
        spanId: row.spanId, action,
        ...(action === "speaker" ? { speakerLabel: speakerLabel?.trim() } : {}), provenance: "user",
      };
      return next;
    });
    setEditingSpanId(undefined);
    markCheckedAndAdvance(row.spanId);
  }

  function addReaderChoice(row: DialogueExample, label: string) {
    setExtraReaderBySpan((current) => ({ ...current, [row.spanId]: label }));
    pendingReaderFocus.current = { spanId: row.spanId, reader: label };
    applyQuickDecision(row, "speaker", label);
  }

  function markCheckedAndAdvance(spanId: string) {
    const nextChecked = { ...checkedSpanIds, ...Object.fromEntries(Object.keys(corrections).map((id) => [id, true])), [spanId]: true };
    setCheckedSpanIds(nextChecked);
    // Only a first decision advances the required pass; edits to a revisited line stay put.
    if (view !== "review" || checkedSpanIds[spanId] || corrections[spanId]) return;
    const nextIndex = nextUncheckedIndex(reviewRows, currentReviewIndex, nextChecked);
    if (nextIndex < 0) setView("overview");
    else setReviewIndex(nextIndex);
    focusAfterDecision.current = true;
  }

  function nextReviewCard() {
    if (!currentReviewRow) return;
    setReviewIndex((currentReviewIndex + 1) % reviewRows.length);
    setEditingSpanId(undefined);
  }

  function renderOutcomeCard({ row }: ReviewRow) {
    const correction = corrections[row.spanId];
    const displayCategory = effectiveCategory(row, correction);
    const editing = editingSpanId === row.spanId;
    const contextExpanded = Boolean(expandedContext[row.spanId]);
    const fullBefore = row.expandedContextBefore ?? row.contextBefore;
    const fullAfter = row.expandedContextAfter ?? row.contextAfter;
    const shortBefore = compactContext(row.contextBefore ?? fullBefore, "before");
    const shortAfter = compactContext(row.contextAfter ?? fullAfter, "after");
    const canExpandContext = compactContext(fullBefore, "before", Infinity) !== shortBefore || compactContext(fullAfter, "after", Infinity) !== shortAfter;
    const contextBefore = contextExpanded ? fullBefore : shortBefore;
    const contextAfter = contextExpanded ? fullAfter : shortAfter;
    const suggestedSpeakers = (row.suggestedSpeakers ?? []).map(usableSpeakerLabel).filter(Boolean);
    const originalAiReader = row.origin === "qwen:not-vocalisation" ? "Narrator"
      : row.speakerStatus === "ai" ? usableSpeakerLabel(row.speakerLabel) : "";
    const chosen = correction?.action === "narrator" ? "Narrator" : correction?.speakerLabel
      ?? (checkedSpanIds[row.spanId] ? originalAiReader : "");
    const readers = [...new Set([originalAiReader, ...suggestedSpeakers, extraReaderBySpan[row.spanId], chosen].filter((label): label is string => Boolean(label) && label !== "Narrator")), "Narrator"];
    const readerKeys = new Set(readers.map(searchKey));
    const otherReaders = speakerOptions.filter((label) => !readerKeys.has(searchKey(label)));
    const query = searchTokens(draftSpeaker);
    const visibleSpeakerOptions = otherReaders.filter((label) => query.every((token) => searchKey(label).includes(token))).slice(0, 8);
    const newReader = draftSpeaker.trim();
    if (newReader && !readerKeys.has(searchKey(newReader)) && !otherReaders.some((label) => searchKey(label) === searchKey(newReader))) visibleSpeakerOptions.push(newReader);

    return <article className={`ai-outcome ${categoryClass(displayCategory)} ${correction ? "user-corrected" : ""} dialogue-focused-outcome`} key={row.spanId}>
      <div>
        <div className="ai-source-heading">
          <small>{t("Source · page {{page}}", { page: row.page })}</small>
          {canExpandContext && <button type="button" className="source-context-toggle" aria-label={t(contextExpanded ? "Show less source context" : "Show more source context")} aria-expanded={contextExpanded} onClick={() => setExpandedContext((current) => ({ ...current, [row.spanId]: !current[row.spanId] }))}><span aria-hidden="true">{contextExpanded ? "−" : "+"}</span>{t(contextExpanded ? "Less context" : "More context")}</button>}
        </div>
        <SourceExcerpt className={`ai-source-evidence ${contextExpanded ? "expanded" : ""}`} source={row.source} contextBefore={contextBefore} contextAfter={contextAfter} />
      </div>
      <div>
        <div className="dialogue-decision-heading"><small>{t("Who reads this line?")}</small>{!originalAiReader && !suggestedSpeakers.length && <span className="dialogue-no-guess">{t("No AI guess")}</span>}</div>
        {spokenTextDiffersFromSource(row) && <p className="ai-spoken-text">{t("Spoken as: {{text}}", { text: row.spokenText })}</p>}
        <div className="dialogue-change-choices">
          <div>
            {readers.map((reader) => {
              const isChosen = reader === chosen;
              const aiLabel = reader === originalAiReader ? "AI choice" : suggestedSpeakers.includes(reader) ? "AI suggestion" : undefined;
              return <button type="button" key={reader} ref={(node) => { (readerButtons.current[row.spanId] ??= {})[reader] = node; }} className={`dialogue-reader-option ${reader === "Narrator" ? "quick-narrator" : "quick-speaker"} ${isChosen ? "selected" : ""} ${aiLabel ? "ai-option" : ""} ${aiLabel && chosen && !isChosen ? "ai-option-muted" : ""}`}
                aria-label={reader === "Narrator" ? t("Choose Narrator") : t("Choose {{name}}", { name: reader })}
                aria-pressed={isChosen} aria-description={aiLabel ? t(aiLabel) : undefined}
                onClick={() => applyQuickDecision(row, reader === "Narrator" ? "narrator" : "speaker", reader === "Narrator" ? undefined : reader)}>
                <span>{reader === "Narrator" ? t("Narrator") : reader}{isChosen ? <span className="dialogue-choice-check" aria-hidden="true"> ✓</span> : aiLabel && <span className="dialogue-ai-mark" aria-hidden="true"> ✧</span>}</span>
              </button>;
            })}
            {otherReaders.length > 0 && <button type="button" ref={(node) => { characterTriggers.current[row.spanId] = node; }} className="quick-character-picker" aria-label={t("Choose another character")} aria-pressed={editing} onClick={() => editing ? closeCharacterEditor() : beginCharacterCorrection(row)}>{t("Other reader…")}</button>}
          </div>
        </div>

        {editing && <div ref={characterEditor} className="dialogue-character-editor">
          <label htmlFor={speakerFieldId}>{t("Character name")}</label>
          <input
            id={speakerFieldId}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={speakerOptions.length ? speakerOptionsId : undefined}
            aria-expanded={visibleSpeakerOptions.length > 0}
            aria-activedescendant={visibleSpeakerOptions[activeSpeakerOption] ? `${speakerOptionsId}-${activeSpeakerOption}` : undefined}
            value={draftSpeaker}
            onChange={(event) => { setDraftSpeaker(event.target.value); setActiveSpeakerOption(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && visibleSpeakerOptions.length) {
                event.preventDefault();
                setActiveSpeakerOption((current) => Math.min(current + 1, visibleSpeakerOptions.length - 1));
              } else if (event.key === "ArrowUp" && visibleSpeakerOptions.length) {
                event.preventDefault();
                setActiveSpeakerOption((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && visibleSpeakerOptions[activeSpeakerOption]) {
                event.preventDefault();
                addReaderChoice(row, visibleSpeakerOptions[activeSpeakerOption]);
              } else if (event.key === "Escape") {
                closeCharacterEditor();
              }
            }}
            placeholder={t("Search or type a character name")}
            autoFocus
          />
          {visibleSpeakerOptions.length > 0 && <ul id={speakerOptionsId} className="dialogue-character-options" role="listbox" aria-label={t("Character options")}>{visibleSpeakerOptions.map((label, index) => <li role="none" key={label}><button id={`${speakerOptionsId}-${index}`} role="option" aria-selected={index === activeSpeakerOption} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addReaderChoice(row, label)}>{label}</button></li>)}</ul>}
        </div>}

      </div>
    </article>;
  }

  function applyBulkChoice(acceptGuesses: boolean) {
    setBulkUndo({ corrections: { ...corrections }, checked: { ...checkedSpanIds } });
    const next = { ...corrections };
    const checked = { ...checkedSpanIds };
    for (const { row } of reviewRows) {
      if (checked[row.spanId] || next[row.spanId]) continue;
      const guess = acceptGuesses ? aiGuess(row) : "";
      // Keep agreed AI assignments implicit to preserve AI provenance.
      if (!guess || row.speakerStatus !== "ai") next[row.spanId] = {
        spanId: row.spanId, action: guess ? "speaker" : "narrator",
        ...(guess ? { speakerLabel: guess } : {}), provenance: "user",
      };
      checked[row.spanId] = true;
    }
    focusAfterDecision.current = true;
    setView("overview");
    setCorrections(next);
    setCheckedSpanIds(checked);
    setEditingSpanId(undefined);
  }

  function undoBulkChoice() {
    if (!bulkUndo) return;
    focusAfterDecision.current = true;
    setCorrections(bulkUndo.corrections);
    setCheckedSpanIds(bulkUndo.checked);
    setReviewIndex(Math.max(0, reviewRows.findIndex(({ row }) => !bulkUndo.checked[row.spanId] && !bulkUndo.corrections[row.spanId])));
    setBulkUndo(undefined);
    setView("review");
  }

  return <section className="dialogue-result-workspace">
    <fieldset className="dialogue-review-controls" disabled={busy}>
    <header className="dialogue-result-hero">
      <div className="dialogue-result-intro">
        <div><h1 ref={overviewHeading} tabIndex={-1}>{t("Your transcript")}</h1></div>
      </div>
    </header>

    {view !== "overview" && <section className="dialogue-checks-panel" aria-label={t("Dialogue checks")}>
      <header className={`dialogue-checks-heading ${view === "all" ? "with-filters" : ""}`}>
        {view === "all" ? <><button type="button" className="ghost dialogue-back-to-readers" onClick={() => changeView("overview")}>← {t("Back to readers")}</button>
        <div className="dialogue-result-toolbar" ref={reviewHeading} tabIndex={-1}>
          <div className="dialogue-result-filters" role="group" aria-label={t("Filter AI results")}>
            {filterOptions.filter(([value]) => value !== "not-dialogue" || counts[value] > 0).map(([value, label]) => <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
            >{t(label)}<small>{counts[value]}</small></button>)}
          </div>
        </div>
        </> : <h2>{t("Check dialogue")}</h2>}
      </header>
    {view === "review" && <section className="dialogue-guided-review" aria-label={t("Review uncertain lines")}>
      {currentReviewRow ? <>
        <div className="dialogue-review-position" ref={reviewHeading} tabIndex={-1}>
          <div><b aria-live="polite">{t("Line {{current}} of {{count}}", { current: currentReviewIndex + 1, count: reviewRows.length })}</b></div>
          <nav className="dialogue-review-navigation" aria-label={t("Guided dialogue review")}>
            <button className="ghost compact" aria-label={t("Previous")} disabled={currentReviewIndex === 0} onClick={() => { setReviewIndex(currentReviewIndex - 1); setEditingSpanId(undefined); }}>←</button>
            <button className="ghost compact" disabled={reviewRows.length < 2} onClick={nextReviewCard}>{t(currentReviewRow && (checkedSpanIds[currentReviewRow.row.spanId] || corrections[currentReviewRow.row.spanId]) ? "Next" : "Skip for now")} →</button>
          </nav>
        </div>
        <div className="dialogue-review-examples dialogue-guided-example">{renderOutcomeCard(currentReviewRow)}</div>
      </> : <div className="empty-dialogue"><b>{t("Every line has a reader")}</b><span>{t("Accept the result or check the AI assignments.")}</span></div>}
    </section>}

    {view === "all" && <section className="dialogue-all-assignments" aria-label={t("AI checks")}>
      {result.examples.length ? <>


        {pageCount > 0 && <nav className="example-pagination" aria-label={t("AI dialogue examples")}><button className="ghost" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setEditingSpanId(undefined); }}>← {t("Previous")}</button><span>{t("Line {{current}} of {{count}}", { current: currentPage + 1, count: filteredRows.length })}</span><button className="ghost" disabled={currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1); setEditingSpanId(undefined); }}>{t("Next")} →</button></nav>}
        <div className="dialogue-review-examples dialogue-guided-example">{visibleRows.map((reviewRow) => renderOutcomeCard(reviewRow))}</div>
        {filteredRows.length === 0 && <p className="dialogue-empty-filter">{t(filter === "review" ? "No lines need review." : "No lines in this view.")}</p>}
      </> : <div className="empty-dialogue"><b>{t("No AI decisions to review.")}</b><span>{t("Every detected line already had a clear reader.")}</span></div>}
    </section>}

    {remainingReviewCount > 0 && <section className="dialogue-review-required" aria-label={t("Review required")}>
      <span className="dialogue-bulk-label">{t("Remaining lines")}</span>
      <div className="dialogue-bulk-actions">
        <button type="button" aria-label={t("Accept all AI guesses")} onClick={() => applyBulkChoice(true)}>{t("Accept AI guesses")} <span className="dialogue-bulk-warning" aria-hidden="true">⚠</span></button>
        <button type="button" aria-label={t("Use narrator for remaining")} onClick={() => applyBulkChoice(false)}>{t("Use narrator")}</button>
      </div>
    </section>}
    </section>}

    {view === "overview" && <section className="dialogue-overview" aria-label={t("Dialogue overview")}>
      <section className="dialogue-reader-overview" aria-label={t("By reader")}>
        <header>
          <div><b>{t("By reader")}</b></div>
          <div className="dialogue-reader-legend" role="group" aria-label={t("Reader assignment legend")}>
            {legend.map(({ key, label }) => <span className={key} key={key}>{t(label)}</span>)}
          </div>
        </header>
        <div className="dialogue-reader-grid">
          {visibleReaderAssignments.map((assignment) => <div className={`dialogue-reader-card ${assignment.label === "Narrator" ? "narrator" : ""}`} key={assignment.label}>
            <div><span>{assignment.label === "Narrator" ? t("Narrator") : assignment.label}</span><b>{assignment.total}</b></div>
            <span className="dialogue-reader-track">
              <span className="dialogue-reader-composition" role="img" aria-label={readerBreakdown(assignment, t)} style={{ width: `${assignment.total / largestReaderTotal * 100}%` }}>
                {assignment.label === "Narrator"
                  ? <i className="fallback" style={{ width: "100%" }} />
                  : <>
                    {assignment.known > 0 && <i className="known" style={{ width: `${assignment.known / assignment.total * 100}%` }} />}
                    {assignment.ai > 0 && <i className="ai" style={{ width: `${assignment.ai / assignment.total * 100}%` }} />}
                    {assignment.user > 0 && <i className="changed" style={{ width: `${assignment.user / assignment.total * 100}%` }} />}
                  </>}
              </span>
            </span>
          </div>)}
        </div>
        <div className="dialogue-overview-actions">{rows.length > 0 && view === "overview" && <button type="button" className="text-button" onClick={() => { changeView(remainingReviewCount ? "review" : "all"); if (remainingReviewCount) setReviewIndex(reviewRows.findIndex(({ row }) => !checkedSpanIds[row.spanId] && !corrections[row.spanId])); }}>{t(remainingReviewCount ? "Review remaining lines" : "Check your choices")}</button>}{bulkUndo && <button type="button" className="text-button" onClick={undoBulkChoice}>{t("Undo bulk choice")}</button>}</div>
        {hiddenReaderCount > 0 && <footer><button type="button" className="ghost compact" onClick={() => setReaderLimit((current) => current + overviewReaderStep)}>{t("Show {{count}} more readers", { count: Math.min(overviewReaderStep, hiddenReaderCount) })} ↓</button></footer>}
      </section>
    </section>}

    <div className="phase-action dialogue-floating-action" role="group" aria-label={`${t("Change strategy")} / ${t("Accept dialogue result")}`}><button ref={strategyTriggerRef} className="ghost" onClick={() => setConfirmStrategy(true)}>{t("Change strategy")}</button><button className="primary" disabled={busy || remainingReviewCount > 0 || requireChanges && !decisionsChanged} onClick={() => { if (!busy && remainingReviewCount === 0) onAccept(orderedDecisions); }}>{t("Continue")} →</button></div>
    </fieldset>
    {confirmStrategy && <DialogBackdrop className="dialogue-strategy-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmStrategy(false); }}>
      <DialogSurface className="dialogue-strategy-confirm" aria-labelledby={strategyTitleId} aria-describedby={strategyDescriptionId} initialFocusRef={cancelStrategyRef} returnFocusRef={strategyTriggerRef} onDismiss={() => setConfirmStrategy(false)}>
        <h2 id={strategyTitleId}>{t("Change dialogue strategy?")}</h2>
        <p id={strategyDescriptionId}>{t("This returns to dialogue settings and discards your unsaved reader choices.")}</p>
        <div><button ref={cancelStrategyRef} type="button" className="ghost" onClick={() => setConfirmStrategy(false)}>{t("Keep reviewing")}</button><button type="button" className="primary" disabled={busy} onClick={() => { if (!busy) { setConfirmStrategy(false); onChangeStrategy(); } }}>{t("Change strategy")}</button></div>
      </DialogSurface>
    </DialogBackdrop>}
  </section>;
}

function compactContext(text: string | undefined, side: "before" | "after", limit = 120) {
  const compact = text?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  const characters = Array.from(compact);
  if (characters.length <= limit) return compact;
  if (side === "before") {
    const excerpt = characters.slice(-limit).join("").trimStart();
    return `…${/\s/.test(characters[characters.length - limit - 1]) ? excerpt : excerpt.replace(/^\S{1,24}\s+/, "")}`;
  }
  const excerpt = characters.slice(0, limit).join("").trimEnd();
  return `${/\s/.test(characters[limit]) ? excerpt : excerpt.replace(/\s+\S{1,24}$/, "")}…`;
}

function aiGuess(row: DialogueExample) {
  return usableSpeakerLabel(row.speakerStatus === "ai" ? row.speakerLabel : row.suggestedSpeakers?.[0]);
}

function searchKey(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchTokens(value: string) {
  return searchKey(value).split(/\s+/).filter(Boolean);
}

function correctionRecord(decisions: DialogueCorrectionDecision[]) {
  return Object.fromEntries(decisions.map((decision) => [decision.spanId, decision]));
}

function correctionSignature(decisions: DialogueCorrectionDecision[]) {
  return JSON.stringify([...decisions]
    .sort((left, right) => left.spanId.localeCompare(right.spanId))
    .map(({ spanId, action, speakerLabel }) => ({ spanId, action, ...(action === "speaker" ? { speakerLabel: speakerLabel?.trim() } : {}) })));
}

function needsAttention(row: DialogueExample) {
  return originalCategory(row) !== "not-dialogue";
}

function fallbackReaderAssignments(rows: DialogueExample[]): DialogueReaderAssignment[] {
  const counts = new Map<string, DialogueReaderAssignment>();
  rows.forEach((row) => {
    const category = originalCategory(row);
    if (category === "not-dialogue") return;
    const label = category === "character" ? usableSpeakerLabel(row.speakerLabel) || "Character" : "Narrator";
    const current = counts.get(label) ?? { label, total: 0, known: 0, ai: 0, user: 0 };
    current.total += 1;
    if (row.speakerStatus === "ai") current.ai += 1;
    counts.set(label, current);
  });
  return [...counts.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function adjustedReaderAssignments(base: DialogueReaderAssignment[], rows: DialogueExample[], corrections: Record<string, DialogueCorrectionDecision>) {
  const counts = new Map(base.map((assignment) => [assignment.label, { ...assignment }]));
  rows.forEach((row) => {
    const correction = corrections[row.spanId];
    if (!correction) return;
    const baseCategory = originalCategory(row);
    const originalLabel = baseCategory === "character" ? usableSpeakerLabel(row.speakerLabel) || "Character" : "Narrator";
    const nextLabel = correction.action === "speaker" ? correction.speakerLabel?.trim() || "Character" : "Narrator";
    const original = counts.get(originalLabel);
    if (original && row.origin !== "qwen:not-vocalisation") {
      original.total = Math.max(0, original.total - 1);
      if (row.speakerStatus === "ai") original.ai = Math.max(0, original.ai - 1);
      else if (row.speakerStatus === "user") original.user = Math.max(0, original.user - 1);
      else if (originalLabel !== "Narrator") original.known = Math.max(0, original.known - 1);
    }
    const next = counts.get(nextLabel) ?? { label: nextLabel, total: 0, known: 0, ai: 0, user: 0 };
    next.total += 1;
    next.user += 1;
    counts.set(nextLabel, next);
  });
  return [...counts.values()].filter(({ total }) => total > 0).sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function readerBreakdown(assignment: DialogueReaderAssignment, t: (key: string, options?: Record<string, unknown>) => string) {
  if (assignment.label === "Narrator") return t("narrator lines");
  const parts = [assignment.known ? t("{{count}} known", { count: assignment.known }) : "", assignment.ai ? t("{{count}} AI", { count: assignment.ai }) : "", assignment.user ? t("{{count}} changed", { count: assignment.user }) : ""].filter(Boolean);
  return parts.join(" · ") || t("dialogue lines");
}

function nextUncheckedIndex(rows: ReviewRow[], currentIndex: number, checked: Record<string, boolean>) {
  for (let index = currentIndex + 1; index < rows.length; index += 1) if (!checked[rows[index].row.spanId]) return index;
  for (let index = 0; index < currentIndex; index += 1) if (!checked[rows[index].row.spanId]) return index;
  return -1;
}

function originalCategory(row: DialogueExample): DialogueCategory {
  if (row.origin === "qwen:not-vocalisation") return "not-dialogue";
  if (row.speakerStatus !== "ai" && row.suggestedSpeakers?.length) return "suggested";
  return row.speakerStatus === "ai" ? "character" : "unsure";
}

function effectiveCategory(row: DialogueExample, correction?: DialogueCorrectionDecision): DialogueCategory {
  if (correction?.action === "speaker") return "character";
  if (correction?.action === "narrator") return "narrator";
  return originalCategory(row);
}

function spokenTextDiffersFromSource(row: DialogueExample) {
  const normalise = (value: string) => value.trim().replace(/^["“”‘’']+|["“”‘’']+$/g, "").replace(/\s+/g, " ").trim();
  return normalise(row.source) !== normalise(row.spokenText);
}

function usableSpeakerLabel(label?: string | null) {
  const value = label?.trim() ?? "";
  return /^\?+$/.test(value) ? "" : value;
}

function categoryClass(category: DialogueCategory) {
  if (category === "character") return "attributed";
  if (category === "suggested") return "suggested";
  if (category === "narrator" || category === "not-dialogue") return "rejected";
  return "unresolved";
}

function reviewPriority(row: DialogueExample) {
  const suggestions = row.suggestedSpeakers?.length ?? 0;
  return suggestions >= 2 ? 0 : suggestions === 1 ? 1 : 2;
}


function prioritizeNarrator(assignments: DialogueReaderAssignment[]) {
  const narrator = assignments.find(({ label }) => label === "Narrator");
  const characters = assignments.filter(({ label }) => label !== "Narrator");
  return narrator ? [...characters.slice(0, 3), narrator, ...characters.slice(3)] : assignments;
}
