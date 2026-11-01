import { useEffect, useState } from "react";
import { ocrReviewDecisions, remainingOcrPages } from "../workflow/ocrReview";
import type {
  AcceptanceDecision,
  ReviewCapability,
  WizardSnapshot
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { Panel, Tag } from "../components/Ui";
import { SourceExcerpt } from "../components/SourceExcerpt";
import { AcceptedSummary, PageTitle, ReviewTranscriptFinalCheck, StageLaunch } from "../pages/shared";
import { buildReviewWarningDecisions } from "../reviewDecisions";
import {
  message, userFacingDetail
} from "../workflow/presentation";
import {
  normalizeCandidateWarnings,
  reviewDefaultDecisions,
  reviewHasBoundaryEvidence,
  reviewActionTitle,
  reviewConsequence,
  reviewDecisionActions,
  reviewGuidance,
  reviewQuestion,
  reviewWarningLabel,
  reviewOccurrenceActions,
  reviewWarningResolved,
  reviewProposalDecisions,
  reviewUsesOccurrenceDecisions,
  reviewIsVerifiedScriptGroup,
  reviewScriptCueDecisions,
  reviewIsPatternGroup,
  reviewPatternDecisions,
  reviewSuggestedAction,
} from "../workflow/review";

export type ReviewPageModel = Pick<WorkflowModel, "recoverExtractionPages" | "reviewQueueSelection" | "setReviewQueueSelection" | "acceptCandidate" | "activeBoundary" | "activeOccurrence" | "activeReviewGroup" | "activeWarning" | "book" | "boundaryDecisions" | "busy" | "completed" | "gateway" | "processCandidate" | "reviewCandidate" | "reviewDecisions" | "reviewFinalCheck" | "reviewPreviewLoading" | "reviewPreviewPage" | "reviewStripRef" | "reviewTranscriptPreview" | "reviewTransition" | "revisingStages" | "setActiveBoundary" | "setActiveOccurrence" | "setActiveReviewGroup" | "setActiveWarning" | "setBoundaryDecisions" | "setError" | "setProcessMessage" | "setProgress" | "setReviewCandidate" | "setReviewDecisions" | "setReviewFinalCheck" | "setReviewPreviewPage" | "setReviewTransition" | "setRevisingStages" | "setStage" | "snapshot" | "stageIndex" | "t">;

function MissingTextSourceImage({ bookId, page, gateway, t, onError }: {
  bookId: string; page: number; gateway: WorkflowModel["gateway"];
  t: WorkflowModel["t"]; onError: WorkflowModel["setError"];
}) {
  const [sourceImage, setSourceImage] = useState<{ bookId: string; page: number; url: string }>();
  useEffect(() => {
    if (!bookId || !page) return;
    let disposed = false;
    void gateway.previewExtraction(bookId, page, "native").then((preview) => {
      if (!disposed && preview.imageUrl) setSourceImage({ bookId, page, url: preview.imageUrl });
    }).catch((reason) => { if (!disposed) onError(message(reason)); });
    return () => { disposed = true; };
  }, [bookId, page, gateway, onError]);
  const url = sourceImage?.bookId === bookId && sourceImage?.page === page ? sourceImage.url : undefined;
  return <div className="review-missing-page-preview">{url
    ? <img src={url} alt={t("Original page {{page}}", { page })} />
    : <p role="status">{t("Loading original page…")}</p>}</div>;
}

export function ReviewPage({ model }: { model: ReviewPageModel; }) {
  const { recoverExtractionPages, reviewQueueSelection, setReviewQueueSelection, acceptCandidate, activeBoundary, activeOccurrence, activeReviewGroup, activeWarning, book, boundaryDecisions, busy, completed, gateway, processCandidate, reviewCandidate, reviewDecisions: selectedReviewDecisions, reviewFinalCheck, reviewPreviewLoading, reviewPreviewPage, reviewStripRef, reviewTranscriptPreview, reviewTransition, revisingStages, setActiveBoundary, setActiveOccurrence, setActiveReviewGroup, setActiveWarning, setBoundaryDecisions, setError, setProcessMessage, setProgress, setReviewCandidate, setReviewDecisions, setReviewFinalCheck, setReviewPreviewPage, setReviewTransition, setRevisingStages, setStage, snapshot, stageIndex, t } = model;
  const candidateWarnings = normalizeCandidateWarnings(reviewCandidate ?? { warnings: snapshot?.warnings }).map((warning) => ({ ...warning, availableActions: reviewDecisionActions(warning) }));
  const reviewDecisions = reviewDefaultDecisions(candidateWarnings, ocrReviewDecisions(reviewCandidate, selectedReviewDecisions));
  const bulkOcrPages = remainingOcrPages(candidateWarnings, reviewDecisions);
  const ocrResult = reviewCandidate?.ocrRecovery;
  const ocrUnchangedPages = [...(ocrResult?.emptyPages ?? []), ...(ocrResult?.unchangedPages ?? [])].sort((a, b) => a - b);
  const ocrNotice = ocrResult && <div className="ocr-review-result"><p className="panel-copy" role="status">
    {t("OCR recovered text on {{count}} pages.", { count: ocrResult.recoveredPages.length })}{" "}
    {ocrUnchangedPages.length > 0 && t("Pages {{pages}} returned no additional text; their saved text was kept.", { pages: ocrUnchangedPages.join(", ") })}{" "}
    {t("Review the OCR results with the complete transcript.")}
  </p><div className="sample-reasons">{ocrResult.requestedPages.map((page) => <button key={page} onClick={() => {
    setReviewPreviewPage(page); setReviewFinalCheck(true);
  }}>{t("p. {{page}}", { page })}</button>)}</div></div>;
  const scriptSummary = reviewCandidate?.scriptDirectionsSummary as { kept?: number } | undefined;
  const keptScriptCount = Number.isSafeInteger(scriptSummary?.kept) && Number(scriptSummary?.kept) > 0 ? Number(scriptSummary?.kept) : 0;
  const boundaries = reviewCandidate && Array.isArray(reviewCandidate.boundaryCandidates) ? reviewCandidate.boundaryCandidates as WizardSnapshot["boundaryCandidates"] : snapshot?.boundaryCandidates ?? [];
  const warning = candidateWarnings[Math.min(activeWarning, Math.max(0, candidateWarnings.length - 1))];
  const occurrence = warning?.occurrences[Math.min(activeOccurrence, Math.max(0, warning.occurrences.length - 1))];
  const missingText = warning && ["empty-page", "missing-image-text"].includes(warning.kind)
    && !["epub", "text"].includes(book?.sourceKind ?? "pdf");
  const boundaryEvidence = occurrence && reviewHasBoundaryEvidence(occurrence);
  const isPatternGroup = warning && reviewIsPatternGroup(warning);
  const pendingPatternCount = isPatternGroup ? warning.occurrences.filter((row) => reviewDecisions[row.id] === undefined).length : 0;
  const isAiCleanup = warning?.kind === "ai-cleanup";
  const isScriptCue = warning && reviewIsVerifiedScriptGroup(warning);
  const pendingCueCount = isScriptCue ? warning.occurrences.filter((row) => reviewDecisions[row.id] === undefined && reviewOccurrenceActions(warning, row).includes("exclude")).length : 0;
  const perOccurrence = warning && reviewUsesOccurrenceDecisions(warning);
  const hasCleanupSuggestion = isAiCleanup || occurrence?.proposalStatus != null || typeof occurrence?.replacement === "string";
  const actionWarning = warning && occurrence ? { ...warning, kind: hasCleanupSuggestion && !isPatternGroup ? "ai-cleanup" : warning.kind, readerState: occurrence.readerState ?? warning.readerState, occurrences: perOccurrence ? [occurrence] : warning.occurrences } : warning;
  const selectedAction = occurrence && perOccurrence ? reviewDecisions[occurrence.id] : warning && reviewDecisions[warning.id];
  const occurrenceActions = warning && occurrence ? reviewOccurrenceActions(warning, occurrence) : [];
  const deletionSuggestion = hasCleanupSuggestion && occurrence?.replacement === "" && occurrenceActions.includes("repair");
  const visibleActions = isAiCleanup || isPatternGroup
    ? (["keep", "exclude", "repair"] as ReviewCapability[]).filter((action) => occurrenceActions.includes(action) && (action !== "repair" || !deletionSuggestion))
    : occurrenceActions;
  const proposals = candidateWarnings.filter((group) => group.kind === "ai-cleanup").flatMap((group) => group.occurrences.filter((row) => reviewSuggestedAction(group, row)).map((row) => ({ warning: group, occurrence: row })));
  const pendingProposalCount = proposals.filter(({ occurrence: row }) => reviewDecisions[row.id] === undefined).length;
  const pendingSuggestionCount = isPatternGroup ? pendingPatternCount : isScriptCue ? pendingCueCount : pendingProposalCount;
  const suggestionCount = isPatternGroup ? warning.occurrences.length : isScriptCue ? warning.occurrences.filter((row) => reviewOccurrenceActions(warning, row).includes("exclude")).length : proposals.length;
  const showBulkSuggestions = (isPatternGroup || isScriptCue || isAiCleanup) && suggestionCount > 1;
  const bulkHelp = t(pendingSuggestionCount > 0 ? "Your manual choices are preserved." : "No undecided suggestions remain. You can still change individual choices.");
  const boundary = boundaries[Math.min(activeBoundary, Math.max(0, boundaries.length - 1))];
  const showingBoundary = boundaries.length > 0 && (activeReviewGroup === "chapters" || candidateWarnings.length === 0);
  const complete = candidateWarnings.every((row) => reviewWarningResolved(row, reviewDecisions)) && boundaries.every((row) => Boolean(boundaryDecisions[row.id]));
  const totalGroups = candidateWarnings.length + (boundaries.length ? 1 : 0);
  const decidedGroups = candidateWarnings.filter((row) => reviewWarningResolved(row, reviewDecisions)).length + (boundaries.length && boundaries.every((row) => Boolean(boundaryDecisions[row.id])) ? 1 : 0);

  // Keep a manually reopened completed category selected without carrying it into another review.
  function reviewQueueKey(group: string) {
    return JSON.stringify([book?.id, reviewCandidate?.revision, group]);
  }

  function isMobileReview() {
    return Boolean(window.matchMedia?.("(max-width: 700px)").matches);
  }

  function revealReviewGroup(group: string) {
    if (isMobileReview()) return revealMobileReview("category");
    const target = reviewStripRef.current?.querySelector<HTMLElement>(`[data-review-group="${group}"]`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function revealMobileReview(destination: "category" | "queue" | "complete") {
    if (!isMobileReview()) return;
    requestAnimationFrame(() => {
      const strip = reviewStripRef.current;
      const desk = strip?.closest(".review-desk");
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      if (destination === "complete") {
        const button = desk?.parentElement?.querySelector<HTMLButtonElement>(".review-transcript-continue");
        button?.focus({ preventScroll: true });
        // Reveal the new action only when it falls below the viewport; never jump back up.
        if (button && button.getBoundingClientRect().bottom > window.innerHeight - 12) {
          button.scrollIntoView?.({ behavior, block: "end" });
        }
        return;
      }
      const target = destination === "queue"
        ? strip?.closest<HTMLElement>(".review-queue")
        : desk?.querySelector<HTMLElement>(".review-evidence h2");
      if (destination === "queue") {
        const active = strip?.querySelector<HTMLButtonElement>("button.active");
        if (strip && active) {
          const container = strip.getBoundingClientRect();
          const item = active.getBoundingClientRect();
          if (item.top < container.top || item.bottom > container.bottom) {
            strip.scrollTo?.({ top: strip.scrollTop + item.top - container.top, behavior: "instant" });
          }
          active.focus({ preventScroll: true });
        }
      } else target?.focus({ preventScroll: true });
      if (target) {
        const header = strip?.closest(".app-shell")?.querySelector(".topbar");
        const offset = Math.max(0, header?.getBoundingClientRect().bottom ?? 0) + 12;
        target.style.scrollMarginTop = `${offset}px`;
        // Short categories need enough room below the controls to align their heading.
        const tail = desk?.parentElement?.querySelector<HTMLElement>(".review-scroll-tail");
        if (tail) {
          const currentTop = window.scrollY;
          const destinationTop = Math.max(0, currentTop + target.getBoundingClientRect().top - offset);
          // Measure beyond the viewport floor, then remove surplus space before paint.
          tail.style.height = `${window.innerHeight}px`;
          const baseHeight = document.documentElement.scrollHeight - tail.getBoundingClientRect().height;
          const needed = destinationTop + window.innerHeight - baseHeight;
          const preservePosition = currentTop + window.innerHeight - baseHeight;
          tail.style.height = `${Math.ceil(Math.max(0, needed, preservePosition))}px`;
        }
        target.scrollIntoView?.({ behavior, block: "start" });
      }
    });
  }

  function finishCategory(nextDecisions = reviewDecisions, nextBoundaries = boundaryDecisions) {
    setReviewQueueSelection(null);
    const groups = [
      ...(boundaries.length ? [{ kind: "chapters" as const, index: 0, complete: boundaries.every((row) => Boolean(nextBoundaries[row.id])) }] : []),
      ...candidateWarnings.map((row, index) => ({ kind: "warning" as const, index, complete: reviewWarningResolved(row, nextDecisions) })),
    ];
    const current = showingBoundary ? 0 : activeWarning + (boundaries.length ? 1 : 0);
    const next = [...groups.slice(current + 1), ...groups.slice(0, current + 1)].find((group) => !group.complete);
    if (!next) return revealMobileReview("complete");
    if (next.kind === "chapters") {
      setActiveReviewGroup("chapters");
      setActiveBoundary(boundaries.findIndex((row) => !nextBoundaries[row.id]));
    } else {
      const row = candidateWarnings[next.index];
      setActiveReviewGroup("warnings");
      setActiveWarning(next.index);
      setActiveOccurrence(reviewUsesOccurrenceDecisions(row)
        ? Math.max(0, row.occurrences.findIndex((item) => !reviewOccurrenceActions(row, item).includes(nextDecisions[item.id])))
        : 0);
    }
    if (isMobileReview()) revealMobileReview("queue");
    else revealReviewGroup(next.kind === "chapters" ? "chapters" : `warning-${next.index}`);
  }

  function openOccurrence(index: number) {
    setActiveOccurrence(index);
    revealMobileReview("category");
  }

  function openWarning(index: number) {
    setReviewQueueSelection(reviewQueueKey(`warning-${index}`));
    setActiveReviewGroup("warnings");
    setActiveWarning(index);
    if (activeReviewGroup !== "warnings" || activeWarning !== index) setActiveOccurrence(0);
    revealReviewGroup(`warning-${index}`);
  }

  function openHeading(index: number) {
    setActiveBoundary(index);
    revealMobileReview("category");
  }

  function openBoundary(index: number) {
    setReviewQueueSelection(reviewQueueKey("chapters"));
    setActiveReviewGroup("chapters");
    setActiveBoundary(index);
    revealReviewGroup("chapters");
  }

  function chooseBoundaryAction(boundaryId: string, action: "chapter-start" | "not-a-boundary") {
    const nextDecisions = { ...boundaryDecisions, [boundaryId]: action };
    setBoundaryDecisions(nextDecisions);
    if (boundaryDecisions[boundaryId]) return;
    const indices = [...boundaries.keys()];
    const nextBoundary = [...indices.slice(activeBoundary + 1), ...indices.slice(0, activeBoundary + 1)].find((index) => !nextDecisions[boundaries[index].id]);
    if (nextBoundary !== undefined) return openHeading(nextBoundary);
    finishCategory(reviewDecisions, nextDecisions);
  }

  function acceptAllBoundaries() {
    const nextDecisions = Object.fromEntries(boundaries.map((row) => [row.id, "chapter-start"] as const));
    setBoundaryDecisions(nextDecisions);
    finishCategory(reviewDecisions, nextDecisions);
  }

  function chooseReviewAction(warningId: string, action: ReviewCapability) {
    const nextDecisions = { ...reviewDecisions, [warningId]: action };
    setReviewDecisions(nextDecisions);
    if (reviewDecisions[warningId]) return;
    finishCategory(nextDecisions);
  }

  function chooseOccurrenceAction(action: ReviewCapability) {
    if (!warning || !occurrence) return;
    const next = { ...reviewDecisions, [occurrence.id]: action };
    setReviewDecisions(next);
    if (reviewDecisions[occurrence.id]) return;
    const nextIndex = [...warning.occurrences.keys()].find((index) => !next[warning.occurrences[index].id]);
    if (nextIndex !== undefined) openOccurrence(nextIndex);
    else if (reviewWarningResolved(warning, next)) finishCategory(next);
  }

  function applyAllProposals() {
    const next = candidateWarnings.filter((group) => group.kind === "ai-cleanup").reduce((choices, group) => reviewProposalDecisions(group, choices), reviewDecisions);
    setReviewDecisions(next);
    const unresolvedGroup = candidateWarnings.find((group) => group.kind === "ai-cleanup" && !reviewWarningResolved(group, next));
    if (warning && reviewWarningResolved(warning, next)) return finishCategory(next);
    const target = unresolvedGroup ?? proposals[0]?.warning;
    if (!target) return;
    openWarning(candidateWarnings.indexOf(target));
    const unresolved = target.occurrences.findIndex((row) => !next[row.id]);
    if (unresolved >= 0) setActiveOccurrence(unresolved);
  }

  function applyScriptSuggestions() {
    if (!warning) return;
    const next = reviewScriptCueDecisions(warning, reviewDecisions);
    setReviewDecisions(next);
    if (reviewWarningResolved(warning, next)) finishCategory(next);
    else {
      const unresolved = warning.occurrences.findIndex((row) => !reviewOccurrenceActions(warning, row).includes(next[row.id]));
      if (unresolved >= 0) openOccurrence(unresolved);
    }
  }

  function applyPatternSuggestions() {
    if (!warning) return;
    const next = reviewPatternDecisions(warning, reviewDecisions, "exclude");
    setReviewDecisions(next);
    if (reviewWarningResolved(warning, next)) finishCategory(next);
  }

  async function acceptReview() {
    if (!book || !reviewCandidate?.revision) return;
    setReviewTransition(true);
    setProcessMessage("Applying review decisions");
    setProgress(25);
    try {
      const decisions: AcceptanceDecision[] = [...await buildReviewWarningDecisions(
        book.id,
        String(reviewCandidate.revision),
        candidateWarnings,
        reviewDecisions,
        gateway.previewReviewBulk.bind(gateway),
      )];
      setProgress(60);
      decisions.push(...boundaries.map((row) => ({ boundaryId: row.id, action: boundaryDecisions[row.id] })));
      await acceptCandidate("review", reviewCandidate, decisions);
      setProgress(100);
    } finally {
      setReviewTransition(false);
    }
  }
  async function scanForIssues() {
    try {
      const candidate = await processCandidate("review", {}, false);
      setReviewCandidate(candidate);
      setReviewDecisions({});
      setBoundaryDecisions({});
      setActiveBoundary(0);
      setActiveWarning(0);
      setActiveOccurrence(0);
      setActiveReviewGroup(Array.isArray(candidate.boundaryCandidates) && candidate.boundaryCandidates.length ? "chapters" : "warnings");
    } catch (reason) {
      setError(message(reason));
    }
  }

  if (!reviewCandidate && completed.includes("review") && !revisingStages.includes("review")) return <AcceptedSummary stage="review" step={t("Step 3")} title={t("Review complete")} revision={snapshot?.activeArtifacts.review} onRevise={() => {
    setRevisingStages([...new Set([...revisingStages, "review"])]);
    void scanForIssues();
  }}><span><b>{snapshot?.reviewInspection.decisions.length ?? 0}</b><small>{t("Issues resolved")}</small></span><span><b>{snapshot?.chapters.length ?? 0}</b><small>{t("Chapters confirmed")}</small></span></AcceptedSummary>;
  if (!reviewCandidate) return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("Check for issues")} copy={t("Check the text, reading order, and chapter starts before recording.")} />
    <section className="review-scan-scene" aria-label={t("Manuscript review")}>
      <div className="review-scan-copy">
        <p>{t("We check passages from your book using an online service and suggest corrections. You review each suggestion before applying it.")}</p>
        {busy && <p>{t("Checking source words, chapter openings and reading order. Your accepted version remains available while we prepare a new review.")}</p>}
        {busy ? <div className="review-scan-progress" role="status" aria-label={t("Scanning for issues…")}><span className="review-scan-progress-track" aria-hidden="true"><i /></span>{t("Scanning for issues…")}</div>
          : <StageLaunch><button className="primary" onClick={() => void scanForIssues()}>{t("Scan for issues")} →</button></StageLaunch>}
      </div>
      <div className="review-scan-art" aria-hidden="true"><div className="review-scan-page"><i /><i /><i /><i /><i /><i /></div><div className="review-scan-stamp">✦</div></div>
    </section>
  </>;
  const recovery = reviewCandidate?.recovery;
  if (recovery) { const recoveryMessage = userFacingDetail(recovery.message == null ? undefined : String(recovery.message), "Rebuild Dialogue before continuing."); return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("The transcript needs rebuilding before review.")} copy={t("The transcript needs to be rebuilt to match the text from your source document.")} /><Panel eyebrow={t("Source safety check")} title={t("Nothing was lost or accepted incorrectly")} actions={<Tag tone="rose">{t("Needs rebuild")}</Tag>}><p className="panel-copy">{t(recoveryMessage, { defaultValue: recoveryMessage })}</p><div className="strategy-list two"><button className="strategy-card" onClick={() => { setRevisingStages([...new Set([...revisingStages, "dialogue"])]); setStage(stageIndex("dialogue")); }}><strong>{t("Rebuild Dialogue")}</strong><small>{t("Keep your extracted text and rebuild the transcript.")}</small></button></div></Panel></>; }
  if (reviewFinalCheck) return <>{ocrNotice}<ReviewTranscriptFinalCheck
    preview={reviewTranscriptPreview}
    loading={reviewPreviewLoading}
    page={reviewPreviewPage}
    pageCount={reviewTranscriptPreview?.pageCount ?? book?.pageCount ?? 1}
    busy={busy || reviewTransition}
    onPageChange={setReviewPreviewPage}
    onBack={() => setReviewFinalCheck(false)}
    onAccept={() => void acceptReview().catch((reason) => setError(message(reason)))}
  /></>;
  return <>
    <PageTitle stage="review" step={t("Step 3 · Review")} title={t("Review your manuscript")} copy={t("Check the examples and choose what to keep or skip. Changes apply when you accept the review.")} />
    {ocrNotice}
    {keptScriptCount > 0 && <p className="evidence-help" role="status">{t("{{count}} bracketed passages kept spoken. No individual decisions needed.", { count: keptScriptCount })}</p>}
    {totalGroups === 0 ? <WorkflowEmpty className="review-empty" symbol="✓" title={t("Nothing needs review")} copy={t("No chapter starts or text issues need your attention.")} /> : <>

      <div className="review-desk">
      <aside className="review-queue" aria-label={t("Decision queue")}>
        <div className="review-queue-heading"><span className="eyebrow">{t("Decision queue")}</span><b>{t("{{decided}} / {{total}} decided", { decided: decidedGroups, total: totalGroups })}</b></div>
        <nav className="review-strip" aria-label={t("Review groups")} ref={reviewStripRef}>
          {boundaries.length > 0 && <button data-review-group="chapters" aria-current={showingBoundary ? "true" : undefined} className={[showingBoundary && (!boundaries.every((row) => boundaryDecisions[row.id]) || reviewQueueSelection === reviewQueueKey("chapters")) ? "active" : "", boundaries.every((row) => boundaryDecisions[row.id]) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openBoundary(activeBoundary)}><span>{boundaries.every((row) => boundaryDecisions[row.id]) ? "✓" : 1}</span><span><strong>{t("Chapter starts")}</strong><small>{t("{{count}} headings · structure", { count: boundaries.length })}</small></span></button>}
          {candidateWarnings.map((row, index) => <button key={row.id} data-review-group={`warning-${index}`} aria-current={!showingBoundary && index === activeWarning ? "true" : undefined} className={[!showingBoundary && index === activeWarning && (!reviewWarningResolved(row, reviewDecisions) || reviewQueueSelection === reviewQueueKey(`warning-${index}`)) ? "active" : "", reviewWarningResolved(row, reviewDecisions) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openWarning(index)}><span>{reviewWarningResolved(row, reviewDecisions) ? "✓" : index + (boundaries.length ? 2 : 1)}</span><span><strong>{t(reviewWarningLabel(row.kind))}</strong><small>{t(row.occurrences.length === 1 ? "1 occurrence" : "{{count}} occurrences", { count: row.occurrences.length })}{row.severity === "blocking" && ` · ${t("blocking")}`}</small></span></button>)}
        </nav>

      </aside>
      <div className={["review-workspace", showingBoundary ? "chapter-workspace" : "warning-workspace"].join(" ")}>
        {showingBoundary && boundary ? <>
          <section className="review-evidence chapter-review-evidence">
            <div className="review-group-heading"><span><h2 tabIndex={-1}>{t("Chapter starts")}</h2></span><Tag tone="good">{t("Structure")}</Tag></div>
            <div className="occurrence-meta"><b>{t("Heading {{current}} of {{total}}", { current: activeBoundary + 1, total: boundaries.length })}</b><span>{t("Page {{page}}", { page: boundary.page })}</span></div>
            <SourceExcerpt compact contextMode="full" className="review-source-excerpt" layout={boundary.contextLayout === "continuous" ? "passage" : "separate"} label={t("Manuscript context")} source={boundary.source} contextBefore={boundary.contextBefore} contextAfter={boundary.contextAfter} />
            <p className="evidence-help">{t("The highlight marks where the chapter would begin. A title can continue across several lines. The text stays unchanged.")}</p>
            <div className="warning-nav"><button disabled={activeBoundary === 0} onClick={() => openHeading(activeBoundary - 1)}>← {t("Previous heading")}</button><button disabled={activeBoundary >= boundaries.length - 1} onClick={() => openHeading(activeBoundary + 1)}>{t("Next heading")} →</button></div>
          </section>
          <section className="resolution-panel">
            <div className="review-scope"><b>{t("Applies to this heading only")}</b><small>{boundaries.length === 1 ? t("This is the only detected chapter heading.") : t("You can decide separately for the other {{count}} headings.", { count: boundaries.length - 1 })}</small></div>
            <h3>{t("Does this heading start a new chapter?")}</h3>
            <div className="resolution-options" role="group" aria-label={t("Chapter decision for {{heading}}", { heading: boundary.source })}><button aria-pressed={boundaryDecisions[boundary.id] === "chapter-start"} className={boundaryDecisions[boundary.id] === "chapter-start" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "chapter-start")}><b>{t("Start a new chapter")}</b><small>{t("Audio before this heading stays in the previous chapter.")}</small></button><button aria-pressed={boundaryDecisions[boundary.id] === "not-a-boundary"} className={boundaryDecisions[boundary.id] === "not-a-boundary" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "not-a-boundary")}><b>{t("Keep inside the current chapter")}</b><small>{t("This heading will not create a chapter break.")}</small></button></div>
            {boundaries.length > 1 && !boundaries.every((row) => boundaryDecisions[row.id] === "chapter-start") && <div className="chapter-bulk-choice"><span><b>{t("Same decision for every heading?")}</b><small>{t("Mark all {{count}} detected headings as chapter starts. You can still change any one afterward.", { count: boundaries.length })}</small></span><button className="ghost review-bulk-button" onClick={acceptAllBoundaries}>{t("Mark all {{count}} as chapter starts", { count: boundaries.length })}</button></div>}
          </section>
        </> : warning && occurrence && actionWarning ? <>
          <section className="review-evidence">
            <div className="review-group-heading"><span><h2 tabIndex={-1}>{t(reviewWarningLabel(warning.kind))}</h2><p>{t(reviewGuidance(warning), { defaultValue: reviewGuidance(warning) })}</p></span>{isScriptCue ? <Tag tone="good">{t("AI checked")}</Tag> : warning.severity === "blocking" && <Tag tone="rose">{t("blocking")}</Tag>}</div>
            <div className="occurrence-meta"><b>{t("Example {{current}} of {{total}}", { current: activeOccurrence + 1, total: warning.occurrences.length })}</b><span>{boundaryEvidence ? occurrence.boundaryAnchors!.map((anchor) => t("Page {{page}}", { page: anchor.page })).join(" → ") : t("Page {{page}}", { page: occurrence.page })}</span></div>
            {missingText ? <MissingTextSourceImage bookId={book?.id ?? ""} page={occurrence.page} gateway={gateway} t={t} onError={setError} /> : <SourceExcerpt compact className="review-source-excerpt" layout={occurrence.contextLayout === "continuous" ? "passage" : "separate"} label={t("Manuscript context")} source={(boundaryEvidence ? occurrence.boundarySource : occurrence.source) || t("No text was extracted here")} contextBefore={occurrence.contextBefore} contextAfter={occurrence.contextAfter} />}
            <div className="warning-nav"><button disabled={activeOccurrence === 0} onClick={() => openOccurrence(activeOccurrence - 1)}>← {t("Previous example")}</button><button disabled={activeOccurrence >= warning.occurrences.length - 1} onClick={() => openOccurrence(activeOccurrence + 1)}>{t("Next example")} →</button></div>
          </section>
          <section className={`resolution-panel${showBulkSuggestions ? " has-bulk-choice" : ""}`}>
            {!isPatternGroup && <div className="review-scope"><b>{t(perOccurrence || warning.occurrences.length === 1 ? "Applies to this occurrence" : "Applies to all {{count}} occurrences in this group", { count: warning.occurrences.length })}</b><small>{t(perOccurrence ? "Each suggestion keeps its own decision. Changes apply when you accept the review." : "Review each example on the left before choosing once.")}</small></div>}
            <h3>{t(hasCleanupSuggestion && occurrence.cueVerification !== "verified" && typeof occurrence.replacement !== "string" ? "Does this text match the source?" : reviewQuestion(actionWarning.kind))}</h3>
            <div className="resolution-options">
              {missingText && <button disabled={busy} onClick={() => void recoverExtractionPages([occurrence.page])}>
                <b>{t("Recover this page with OCR")}</b><small>{t("Read only page {{page}} again and add the best OCR result to your transcript.", { page: occurrence.page })}</small>
              </button>}
              {missingText && bulkOcrPages.length > 1 && <button disabled={busy} onClick={() => void recoverExtractionPages(bulkOcrPages)}>
                <b>{t("Recover all {{count}} flagged pages with OCR", { count: bulkOcrPages.length })}</b>
                <small>{t("Read every remaining page marked as empty or possible image text. Review the results with the complete transcript.")}</small>
              </button>}
              {visibleActions.map((action) => {
                const recommended = ((isScriptCue || isAiCleanup) && occurrence.recommendedAction === action)
                  || (hasCleanupSuggestion && (deletionSuggestion ? action === "exclude" : action === "repair"));
                const selected = selectedAction === action || (deletionSuggestion && action === "exclude" && selectedAction === "repair");
                return <button key={action} aria-pressed={selected} aria-description={recommended ? t("Suggested choice for this passage") : undefined} className={[recommended ? "review-recommended" : "", recommended && selectedAction && !selected ? "review-recommended-muted" : "", selected ? "selected" : ""].filter(Boolean).join(" ")} onClick={() => perOccurrence ? chooseOccurrenceAction(action) : chooseReviewAction(warning.id, action)}>
                  <span className="review-choice-title"><b>{t(reviewActionTitle(action, actionWarning))}</b>{selected ? <span className="review-choice-check" aria-hidden="true">✓</span> : recommended && <span className="review-choice-suggestion" aria-hidden="true">✧</span>}</span>
                  <small className={action === "repair" ? "cleanup-replacement" : undefined}>{action === "repair" && typeof occurrence.replacement === "string" && occurrence.replacement !== "" ? occurrence.replacement : reviewConsequence(action, actionWarning, t)}</small>
                </button>;
              })}
              {showBulkSuggestions && <div className="review-bulk-area">
                <button className="cleanup-bulk-warning" title={bulkHelp} aria-description={bulkHelp} disabled={pendingSuggestionCount === 0} onClick={isPatternGroup ? applyPatternSuggestions : isScriptCue ? applyScriptSuggestions : applyAllProposals}>
                  <span aria-hidden="true">{pendingSuggestionCount > 0 ? "⚠" : "✓"}</span>
                  <b>{isPatternGroup && pendingSuggestionCount > 0 ? t("Apply all AI suggestions") : pendingSuggestionCount > 0 ? t("Apply all suggested choices ({{count}})", { count: pendingSuggestionCount }) : t("All suggestions decided")}</b>
                </button>
              </div>}
            </div>
          </section>
        </> : null}
      </div>
      </div>
    </>}
    <div className={`phase-action review-next-action${complete ? "" : " review-pending"}`}>
      <button className="primary review-transcript-continue" disabled={!complete || busy} onClick={() => { setReviewPreviewPage(1); setReviewFinalCheck(true); }}>{t("Review complete transcript")} →</button>
    </div>
    <div className="review-scroll-tail" aria-hidden="true" />
  </>;

}
