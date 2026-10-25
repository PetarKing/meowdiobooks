import { SourceExcerpt } from "./SourceExcerpt";
import { useId, useMemo, useState } from "react";
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
type DialogueFilter = "all" | "character" | "review" | "not-dialogue";
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

const pageSize = 10;
const overviewReaderStep = 4;
const filterOptions: Array<[DialogueFilter, string]> = [
  ["all", "All"],
  ["character", "Assigned"],
  ["review", "Needs review"],
  ["not-dialogue", "Not dialogue"],
];

export function DialogueResultReview({ result, busy, initialDecisions = [], requireChanges = false, onChangeStrategy, onAccept }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<DialogueView>("overview");
  const [filter, setFilter] = useState<DialogueFilter>("all");
  const [page, setPage] = useState(0);
  const [readerLimit, setReaderLimit] = useState(overviewReaderStep);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [checkedSpanIds, setCheckedSpanIds] = useState<Record<string, boolean>>({});
  const [editingSpanId, setEditingSpanId] = useState<string>();
  const [draftSpeaker, setDraftSpeaker] = useState("");
  const [activeSpeakerOption, setActiveSpeakerOption] = useState(0);
  const [corrections, setCorrections] = useState<Record<string, DialogueCorrectionDecision>>(() => correctionRecord(initialDecisions));
  const [expandedContext, setExpandedContext] = useState<Record<string, boolean>>({});
  const speakerFieldId = useId();
  const speakerOptionsId = useId();
  const speakerOptions = useMemo(
    () => [...new Set((result.speakerOptions ?? []).map((label) => label.trim()).filter((label) => label && !/^\?+$/.test(label)))],
    [result.speakerOptions],
  );
  const visibleSpeakerOptions = useMemo(() => {
    const query = searchTokens(draftSpeaker);
    return speakerOptions.filter((label) => query.every((token) => searchKey(label).includes(token))).slice(0, 8);
  }, [draftSpeaker, speakerOptions]);

  const rows = useMemo(() => result.examples.map((row) => ({ row, category: originalCategory(row) })), [result.examples]);
  const reviewRows = useMemo(
    () => rows.filter(({ row }) => needsAttention(row)).sort((left, right) => reviewPriority(left.row) - reviewPriority(right.row)),
    [rows],
  );
  const counts = useMemo(() => ({
    all: rows.length,
    character: rows.filter(({ category }) => category === "character").length,
    review: rows.filter(({ category }) => category === "suggested" || category === "unsure").length,
    "not-dialogue": rows.filter(({ category }) => category === "not-dialogue").length,
  }), [rows]);
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

  const filteredRows = rows.filter(({ category }) => filter === "all" || category === filter || filter === "review" && (category === "suggested" || category === "unsure"));
  const pageCount = Math.ceil(filteredRows.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleRows = filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const currentReviewIndex = Math.min(reviewIndex, Math.max(0, reviewRows.length - 1));
  const currentReviewRow = reviewRows[currentReviewIndex];
  const checkedReviewCount = reviewRows.filter(({ row }) => checkedSpanIds[row.spanId]).length;
  const reviewComplete = reviewRows.length > 0 && checkedReviewCount === reviewRows.length;

  function changeView(next: DialogueView) {
    setView(next);
    setEditingSpanId(undefined);
    if (next === "all") {
      setFilter("all");
      setPage(0);
    }
  }

  function reviewAgain() {
    setCheckedSpanIds({});
    setReviewIndex(0);
    setEditingSpanId(undefined);
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
    setCorrections((current) => ({
      ...current,
      [row.spanId]: {
        spanId: row.spanId,
        action,
        ...(action === "speaker" ? { speakerLabel: speakerLabel?.trim() } : {}),
        provenance: "user",
      },
    }));
    setEditingSpanId(undefined);
    if (view === "review") markCheckedAndAdvance(row.spanId);
  }

  function applyCharacterCorrection(row: DialogueExample) {
    const speakerLabel = draftSpeaker.trim();
    if (!speakerLabel) return;
    applyQuickDecision(row, "speaker", speakerLabel);
  }

  function restoreAiDecision(spanId: string) {
    setCorrections((current) => {
      const next = { ...current };
      delete next[spanId];
      return next;
    });
    setEditingSpanId(undefined);
  }

  function markCheckedAndAdvance(spanId: string) {
    const nextChecked = { ...checkedSpanIds, [spanId]: true };
    setCheckedSpanIds(nextChecked);
    const nextIndex = nextUncheckedIndex(reviewRows, currentReviewIndex, nextChecked);
    if (nextIndex >= 0) setReviewIndex(nextIndex);
  }

  function nextReviewCard() {
    if (!currentReviewRow) return;
    markCheckedAndAdvance(currentReviewRow.row.spanId);
  }

  function renderOutcomeCard({ row, category }: ReviewRow, focused = false) {
    const correction = corrections[row.spanId];
    const displayCategory = effectiveCategory(row, correction);
    const reason = reviewReason(row);
    const editing = editingSpanId === row.spanId;
    const contextExpanded = Boolean(expandedContext[row.spanId]);
    const canExpandContext = Boolean(
      row.expandedContextBefore && row.expandedContextBefore !== row.contextBefore
      || row.expandedContextAfter && row.expandedContextAfter !== row.contextAfter,
    );
    const contextBefore = contextExpanded ? row.expandedContextBefore ?? row.contextBefore : row.contextBefore;
    const contextAfter = contextExpanded ? row.expandedContextAfter ?? row.contextAfter : row.contextAfter;
    const suggestedSpeakers = row.suggestedSpeakers ?? [];

    return <article className={`ai-outcome ${categoryClass(displayCategory)} ${correction ? "user-corrected" : ""} ${focused ? "dialogue-focused-outcome" : ""}`} key={row.spanId}>
      <div>
        <div className="ai-source-heading">
          <small>{t("Source · page {{page}}", { page: row.page })}</small>
          {canExpandContext && <button type="button" className="source-context-toggle" aria-label={t(contextExpanded ? "Show less source context" : "Show more source context")} aria-expanded={contextExpanded} onClick={() => setExpandedContext((current) => ({ ...current, [row.spanId]: !current[row.spanId] }))}><span aria-hidden="true">{contextExpanded ? "−" : "+"}</span>{t(contextExpanded ? "Less context" : "More context")}</button>}
        </div>
        <SourceExcerpt className={`ai-source-evidence ${contextExpanded ? "expanded" : ""}`} source={row.source} contextBefore={contextBefore} contextAfter={contextAfter} />
      </div>
      <div>
        <div className="dialogue-decision-heading">
          <small>{correction
            ? t("Your correction")
            : focused
              ? t(reason.title)
              : category === "suggested" || category === "unsure"
                ? t("Needs review · {{reason}}", { reason: t(reason.short) })
                : category === "not-dialogue"
                  ? t("AI checked · not dialogue")
                  : t("AI assigned")}</small>
          {focused && checkedSpanIds[row.spanId] && <span className="dialogue-checked-badge">{t("Checked")}</span>}
        </div>
        {focused && !correction && <p className="dialogue-review-reason">{t(reason.detail)}</p>}
        <p><b>{t(effectiveOutcomeLabel(displayCategory))}</b>{effectiveSpeaker(row, correction) && <> · {effectiveSpeaker(row, correction)}</>}</p>
        {spokenTextDiffersFromSource(row) && <p className="ai-spoken-text">{t("Spoken as: {{text}}", { text: row.spokenText })}</p>}

        <div className="dialogue-change-choices">
          <small>{suggestedSpeakers.length ? t("Suggested readers") : displayCategory === "character" ? t("Change reader") : t("Choose a character if you know who spoke")}</small>
          <div>
            {suggestedSpeakers.map((speaker) => <button type="button" className="quick-speaker" key={speaker} aria-label={t("Choose {{name}}", { name: speaker })} onClick={() => applyQuickDecision(row, "speaker", speaker)}><span aria-hidden="true">✦</span>{speaker}</button>)}
            <button type="button" className="quick-character-picker" aria-label={t("Choose another character")} aria-pressed={editing} onClick={() => beginCharacterCorrection(row)}><span aria-hidden="true">+</span>{t("Choose character…")}</button>
            {displayCategory === "character" && <button type="button" className="quick-narrator" aria-label={t("Choose Narrator")} onClick={() => applyQuickDecision(row, "narrator")}><span aria-hidden="true">✓</span>{t("Narrator")}</button>}
          </div>
        </div>

        {editing && <div className="dialogue-character-editor">
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
                setDraftSpeaker(visibleSpeakerOptions[activeSpeakerOption]);
                setActiveSpeakerOption(0);
              } else if (event.key === "Escape") {
                setEditingSpanId(undefined);
              }
            }}
            placeholder={t("Search or type a character name")}
            autoFocus
          />
          {visibleSpeakerOptions.length > 0 && <ul id={speakerOptionsId} className="dialogue-character-options" role="listbox" aria-label={t("Character options")}>{visibleSpeakerOptions.map((label, index) => <li role="none" key={label}><button id={`${speakerOptionsId}-${index}`} role="option" aria-selected={index === activeSpeakerOption} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setDraftSpeaker(label); setActiveSpeakerOption(0); }}>{label}</button></li>)}</ul>}
          <small>{t("Pick an existing character or type a new name.")}</small>
          <div>
            <button type="button" className="ghost compact" onClick={() => setEditingSpanId(undefined)}>{t("Cancel")}</button>
            <button type="button" className="primary compact" disabled={!draftSpeaker.trim()} onClick={() => applyCharacterCorrection(row)}>{t("Apply change")}</button>
          </div>
        </div>}

        {correction && !editing && <button type="button" className="text-button dialogue-restore-choice" onClick={() => restoreAiDecision(row.spanId)}>{t("Restore AI choice")}</button>}
      </div>
    </article>;
  }

  return <section className="dialogue-result-workspace">
    <header className="dialogue-result-hero">
      <div className="dialogue-result-intro">
        <span className="dialogue-hero-mark" aria-hidden="true">✦</span>
        <div><small>{t("Step 2 · Dialogue")}</small><h1>{t("Your transcript is ready")}</h1></div>
      </div>
      <DialogueComposition dialogue={{ ...result, readerAssignments }} />
      <div className="dialogue-review-views" role="tablist" aria-label={t("Dialogue review views")}>
        {(["overview", "review", "all"] as DialogueView[]).map((option) => <button
          type="button"
          role="tab"
          key={option}
          aria-selected={view === option}
          className={view === option ? "active" : ""}
          onClick={() => changeView(option)}
        ><span>{t(viewLabel(option))}</span>{option === "review" && reviewRows.length > 0 && <small>{reviewRows.length}</small>}{option === "all" && rows.length > 0 && <small>{rows.length}</small>}</button>)}
      </div>
    </header>

    {view === "overview" && <section className="dialogue-overview" aria-label={t("Dialogue overview")}>
      <section className="dialogue-reader-overview" aria-label={t("By reader")}>
        <header>
          <div><b>{t("By reader")}</b></div>
          <strong>{t("{{count}} readers", { count: readerAssignments.length })}</strong>
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
        {hiddenReaderCount > 0 && <footer><button type="button" className="ghost compact" onClick={() => setReaderLimit((current) => current + overviewReaderStep)}>{t("Show {{count}} more readers", { count: Math.min(overviewReaderStep, hiddenReaderCount) })} ↓</button></footer>}
      </section>
    </section>}

    {view === "review" && <section className="dialogue-guided-review" aria-label={t("Review uncertain lines")}>
      {reviewComplete ? <div className="dialogue-review-complete">
        <span aria-hidden="true">✦</span>
        <b>{t("Review complete")}</b>
        <p>{t("Accept your choices below, or inspect all AI checks.")}</p>
        <button type="button" className="ghost" onClick={reviewAgain}>{t("Review again")}</button>
      </div> : currentReviewRow ? <>
        <div className="dialogue-review-position">
          <div><b>{t("Line {{current}} of {{count}}", { current: currentReviewIndex + 1, count: reviewRows.length })}</b><span>{t("Uncertain lines · suggested speakers first")}</span></div>
          <nav className="dialogue-review-navigation" aria-label={t("Guided dialogue review")}>
            <button className="ghost compact" disabled={currentReviewIndex === 0} onClick={() => { setReviewIndex(currentReviewIndex - 1); setEditingSpanId(undefined); }}>← {t("Previous")}</button>
            <button className="primary compact" onClick={nextReviewCard}>{t("Next")} →</button>
          </nav>
          <span className="dialogue-review-meter" aria-hidden="true"><i style={{ width: `${checkedReviewCount / reviewRows.length * 100}%` }} /></span>
        </div>
        <div className="dialogue-review-examples dialogue-guided-example">{renderOutcomeCard(currentReviewRow, true)}</div>
      </> : <div className="empty-dialogue"><b>{t("Every line has a reader")}</b><span>{t("Accept the result or check the AI assignments.")}</span></div>}
    </section>}

    {view === "all" && <section className="dialogue-all-assignments" aria-label={t("AI checks")}>
      {result.examples.length ? <>
        <div className="dialogue-result-toolbar">
          <div className="dialogue-result-filters" role="group" aria-label={t("Filter AI results")}>
            {filterOptions.map(([value, label]) => <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
            >{t(label)}<small>{counts[value]}</small></button>)}
          </div>
          {filter !== "all" && <span>{t("Showing {{shown}} of {{count}}", { shown: filteredRows.length, count: counts.all })}</span>}
        </div>

        <div className="dialogue-review-examples">{visibleRows.map((reviewRow) => renderOutcomeCard(reviewRow))}</div>

        {pageCount > 1 && <nav className="example-pagination" aria-label={t("AI dialogue examples")}><button className="ghost" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setEditingSpanId(undefined); }}>← {t("Previous")}</button><span>{t("Page {{page}} of {{pages}} · {{count}} lines", { page: currentPage + 1, pages: pageCount, count: filteredRows.length })}</span><button className="ghost" disabled={currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1); setEditingSpanId(undefined); }}>{t("Next")} →</button></nav>}
      </> : <div className="empty-dialogue"><b>{t("No AI decisions to review.")}</b><span>{t("Every detected line already had a clear reader.")}</span></div>}
    </section>}

    <div className="phase-action dialogue-floating-action" role="group" aria-label={`${t("Change strategy")} / ${t("Accept dialogue result")}`}><button className="ghost" onClick={onChangeStrategy}>{t("Change strategy")}</button><button className="primary" disabled={busy || requireChanges && !decisionsChanged} onClick={() => onAccept(orderedDecisions)}>{t("Accept dialogue result")} →</button></div>
  </section>;
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
  return ["suggested", "unsure"].includes(originalCategory(row));
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

function viewLabel(view: DialogueView) {
  if (view === "overview") return "Overview";
  if (view === "review") return "Review";
  return "AI checks";
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

function effectiveSpeaker(row: DialogueExample, correction?: DialogueCorrectionDecision) {
  return correction?.action === "speaker" ? correction.speakerLabel : !correction && row.speakerStatus === "ai" ? row.speakerLabel : undefined;
}

function effectiveOutcomeLabel(category: DialogueCategory) {
  if (category === "character") return "Character";
  if (category === "suggested" || category === "unsure") return "Narrator for now";
  if (category === "not-dialogue") return "Kept as narration";
  return "Narrator";
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

function reviewReason(row: DialogueExample) {
  const suggestions = row.suggestedSpeakers?.length ?? 0;
  if (suggestions >= 2) return { title: "Two possible readers", short: "two possible readers", detail: "AI could not safely choose between them." };
  if (suggestions === 1) return { title: "One possible reader", short: "one possible reader", detail: "AI found a possible speaker. Please confirm." };
  return { title: "No clear speaker", short: "no clear speaker", detail: "No clear speaker was found. Narrator reads this line for now." };
}

function prioritizeNarrator(assignments: DialogueReaderAssignment[]) {
  const narrator = assignments.find(({ label }) => label === "Narrator");
  const characters = assignments.filter(({ label }) => label !== "Narrator");
  return narrator ? [...characters.slice(0, 3), narrator, ...characters.slice(3)] : assignments;
}
