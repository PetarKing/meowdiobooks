import type {
  AcceptanceDecision,
  ReviewCapability,
  WizardSnapshot
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { Panel, Tag } from "../components/Ui";
import { AcceptedSummary, PageTitle, ReviewTranscriptFinalCheck, StageLaunch } from "../pages/shared";
import { buildReviewWarningDecisions } from "../reviewDecisions";
import {
  message, userFacingDetail
} from "../workflow/presentation";
import {
  normalizeCandidateWarnings,
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
} from "../workflow/review";

export type ReviewPageModel = Pick<WorkflowModel, "acceptCandidate" | "activeBoundary" | "activeOccurrence" | "activeReviewGroup" | "activeWarning" | "book" | "boundaryDecisions" | "busy" | "completed" | "gateway" | "processCandidate" | "reviewCandidate" | "reviewDecisions" | "reviewFinalCheck" | "reviewPreviewLoading" | "reviewPreviewPage" | "reviewStripRef" | "reviewTranscriptPreview" | "reviewTransition" | "revisingStages" | "setActiveBoundary" | "setActiveOccurrence" | "setActiveReviewGroup" | "setActiveWarning" | "setBoundaryDecisions" | "setError" | "setProcessMessage" | "setProgress" | "setReviewCandidate" | "setReviewDecisions" | "setReviewFinalCheck" | "setReviewPreviewPage" | "setReviewTransition" | "setRevisingStages" | "setStage" | "snapshot" | "stageIndex" | "t">;

export function ReviewPage({ model }: { model: ReviewPageModel; }) {
  const { acceptCandidate, activeBoundary, activeOccurrence, activeReviewGroup, activeWarning, book, boundaryDecisions, busy, completed, gateway, processCandidate, reviewCandidate, reviewDecisions, reviewFinalCheck, reviewPreviewLoading, reviewPreviewPage, reviewStripRef, reviewTranscriptPreview, reviewTransition, revisingStages, setActiveBoundary, setActiveOccurrence, setActiveReviewGroup, setActiveWarning, setBoundaryDecisions, setError, setProcessMessage, setProgress, setReviewCandidate, setReviewDecisions, setReviewFinalCheck, setReviewPreviewPage, setReviewTransition, setRevisingStages, setStage, snapshot, stageIndex, t } = model;
  const candidateWarnings = normalizeCandidateWarnings(reviewCandidate ?? { warnings: snapshot?.warnings }).map((warning) => ({ ...warning, availableActions: reviewDecisionActions(warning) }));
  const boundaries = reviewCandidate && Array.isArray(reviewCandidate.boundaryCandidates) ? reviewCandidate.boundaryCandidates as WizardSnapshot["boundaryCandidates"] : snapshot?.boundaryCandidates ?? [];
  const warning = candidateWarnings[Math.min(activeWarning, Math.max(0, candidateWarnings.length - 1))];
  const occurrence = warning?.occurrences[Math.min(activeOccurrence, Math.max(0, warning.occurrences.length - 1))];
  const isAiCleanup = warning?.kind === "ai-cleanup";
  const perOccurrence = warning && reviewUsesOccurrenceDecisions(warning);
  const hasCleanupSuggestion = isAiCleanup || occurrence?.proposalStatus != null || typeof occurrence?.replacement === "string";
  const actionWarning = warning && occurrence ? { ...warning, kind: hasCleanupSuggestion ? "ai-cleanup" : warning.kind, readerState: occurrence.readerState ?? warning.readerState, occurrences: perOccurrence ? [occurrence] : warning.occurrences } : warning;
  const selectedAction = occurrence && perOccurrence ? reviewDecisions[occurrence.id] : warning && reviewDecisions[warning.id];
  const occurrenceActions = warning && occurrence ? reviewOccurrenceActions(warning, occurrence) : [];
  const proposals = candidateWarnings.filter((group) => group.kind === "ai-cleanup").flatMap((group) => group.occurrences.filter((row) => reviewOccurrenceActions(group, row).includes("repair")).map((row) => ({ warning: group, occurrence: row })));
  const pendingProposalCount = proposals.filter(({ occurrence: row }) => reviewDecisions[row.id] === undefined).length;
  const boundary = boundaries[Math.min(activeBoundary, Math.max(0, boundaries.length - 1))];
  const showingBoundary = boundaries.length > 0 && (activeReviewGroup === "chapters" || candidateWarnings.length === 0);
  const complete = candidateWarnings.every((row) => reviewWarningResolved(row, reviewDecisions)) && boundaries.every((row) => Boolean(boundaryDecisions[row.id]));
  const totalGroups = candidateWarnings.length + (boundaries.length ? 1 : 0);
  const decidedGroups = candidateWarnings.filter((row) => reviewWarningResolved(row, reviewDecisions)).length + (boundaries.length && boundaries.every((row) => Boolean(boundaryDecisions[row.id])) ? 1 : 0);

  function revealReviewGroup(group: string) {
    const target = reviewStripRef.current?.querySelector<HTMLElement>(`[data-review-group="${group}"]`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function openWarning(index: number) {
    setActiveReviewGroup("warnings");
    setActiveWarning(index);
    setActiveOccurrence(0);
    revealReviewGroup(`warning-${index}`);
  }

  function openBoundary(index: number) {
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
    if (nextBoundary !== undefined) return setActiveBoundary(nextBoundary);
    const nextWarning = candidateWarnings.findIndex((row) => !reviewWarningResolved(row, reviewDecisions));
    if (nextWarning >= 0) openWarning(nextWarning);
  }

  function acceptAllBoundaries() {
    setBoundaryDecisions(Object.fromEntries(boundaries.map((row) => [row.id, "chapter-start"] as const)));
    const nextWarning = candidateWarnings.findIndex((row) => !reviewWarningResolved(row, reviewDecisions));
    if (nextWarning >= 0) openWarning(nextWarning);
  }

  function chooseReviewAction(warningId: string, action: ReviewCapability) {
    const nextDecisions = { ...reviewDecisions, [warningId]: action };
    setReviewDecisions(nextDecisions);
    setActiveOccurrence(0);

    if (reviewDecisions[warningId]) return;
    const currentIndex = candidateWarnings.findIndex((row) => row.id === warningId);
    const nextWarning = [
      ...candidateWarnings.slice(currentIndex + 1),
      ...candidateWarnings.slice(0, currentIndex),
    ].find((row) => !reviewWarningResolved(row, nextDecisions));
    if (nextWarning) return openWarning(candidateWarnings.findIndex((row) => row.id === nextWarning.id));
    const nextBoundary = boundaries.findIndex((row) => !boundaryDecisions[row.id]);
    if (nextBoundary >= 0) openBoundary(nextBoundary);
  }

  function chooseOccurrenceAction(action: ReviewCapability) {
    if (!warning || !occurrence) return;
    const next = { ...reviewDecisions, [occurrence.id]: action };
    setReviewDecisions(next);
    if (reviewDecisions[occurrence.id]) return;
    const nextIndex = [...warning.occurrences.keys()].find((index) => !next[warning.occurrences[index].id]);
    if (nextIndex !== undefined) setActiveOccurrence(nextIndex);
  }

  function applyAllProposals() {
    const next = candidateWarnings.filter((group) => group.kind === "ai-cleanup").reduce((choices, group) => reviewProposalDecisions(group, choices), reviewDecisions);
    setReviewDecisions(next);
    const target = candidateWarnings.find((group) => group.kind === "ai-cleanup" && !reviewWarningResolved(group, next)) ?? proposals[0]?.warning;
    if (!target) return;
    openWarning(candidateWarnings.indexOf(target));
    const unresolved = target.occurrences.findIndex((row) => !next[row.id]);
    if (unresolved >= 0) setActiveOccurrence(unresolved);
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
  if (reviewFinalCheck) return <ReviewTranscriptFinalCheck
    preview={reviewTranscriptPreview}
    loading={reviewPreviewLoading}
    page={reviewPreviewPage}
    pageCount={reviewTranscriptPreview?.pageCount ?? book?.pageCount ?? 1}
    busy={busy || reviewTransition}
    onPageChange={setReviewPreviewPage}
    onBack={() => setReviewFinalCheck(false)}
    onAccept={() => void acceptReview().catch((reason) => setError(message(reason)))}
  />;
  return <>
    <PageTitle stage="review" step={t("Step 3 · Review")} title={t("Review your manuscript")} copy={t("Check the examples and choose what to keep or skip. Changes apply when you accept the review.")} />
    {totalGroups === 0 ? <WorkflowEmpty className="review-empty" symbol="✓" title={t("Nothing needs review")} copy={t("No chapter starts or text issues need your attention.")} /> : <>

      <div className="review-desk">
      <aside className="review-queue" aria-label={t("Decision queue")}>
        <div className="review-queue-heading"><span className="eyebrow">{t("Decision queue")}</span><b>{t("{{decided}} / {{total}} decided", { decided: decidedGroups, total: totalGroups })}</b></div>
        <nav className="review-strip" aria-label={t("Review groups")} ref={reviewStripRef}>
          {boundaries.length > 0 && <button data-review-group="chapters" className={[showingBoundary ? "active" : "", boundaries.every((row) => boundaryDecisions[row.id]) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openBoundary(activeBoundary)}><span>{boundaries.every((row) => boundaryDecisions[row.id]) ? "✓" : 1}</span><span><strong>{t("Chapter starts")}</strong><small>{t("{{count}} headings · structure", { count: boundaries.length })}</small></span></button>}
          {candidateWarnings.map((row, index) => <button key={row.id} data-review-group={`warning-${index}`} className={[!showingBoundary && index === activeWarning ? "active" : "", reviewWarningResolved(row, reviewDecisions) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openWarning(index)}><span>{reviewWarningResolved(row, reviewDecisions) ? "✓" : index + (boundaries.length ? 2 : 1)}</span><span><strong>{t(reviewWarningLabel(row.kind))}</strong><small>{t(row.occurrences.length === 1 ? "1 occurrence" : "{{count}} occurrences", { count: row.occurrences.length })}{row.severity === "blocking" && ` · ${t("blocking")}`}</small></span></button>)}
        </nav>

      </aside>
      <div className={["review-workspace", showingBoundary ? "chapter-workspace" : "warning-workspace"].join(" ")}>
        {showingBoundary && boundary ? <>
          <section className="review-evidence chapter-review-evidence">
            <div className="review-group-heading"><span><h2>{t("Chapter starts")}</h2></span><Tag tone="good">{t("Structure")}</Tag></div>
            <div className="occurrence-meta"><b>{t("Heading {{current}} of {{total}}", { current: activeBoundary + 1, total: boundaries.length })}</b><span>{t("Page {{page}}", { page: boundary.page })}</span></div>
            <div className="chapter-heading-evidence" aria-label={t("Chapter heading evidence")}><span>{t("Possible chapter heading")}</span><i aria-hidden="true">✦</i><h3>{boundary.source}</h3><p>{t(userFacingDetail(boundary.reason, "Detected from an explicit standalone chapter heading."))}</p></div>
            <p className="evidence-help">{t("This sets where the next audio chapter begins. The heading text stays unchanged.")}</p>
            <div className="warning-nav"><button disabled={activeBoundary === 0} onClick={() => setActiveBoundary(activeBoundary - 1)}>← {t("Previous heading")}</button><button disabled={activeBoundary >= boundaries.length - 1} onClick={() => setActiveBoundary(activeBoundary + 1)}>{t("Next heading")} →</button></div>
          </section>
          <section className="resolution-panel">
            <div className="review-scope"><b>{t("Applies to this heading only")}</b><small>{boundaries.length === 1 ? t("This is the only detected chapter heading.") : t("You can decide separately for the other {{count}} headings.", { count: boundaries.length - 1 })}</small></div>
            <h3>{t("Does this heading start a new chapter?")}</h3>
            <div className="resolution-options" role="group" aria-label={t("Chapter decision for {{heading}}", { heading: boundary.source })}><button aria-pressed={boundaryDecisions[boundary.id] === "chapter-start"} className={boundaryDecisions[boundary.id] === "chapter-start" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "chapter-start")}><b>{t("Start a new chapter")}</b><small>{t("Audio before this heading stays in the previous chapter.")}</small></button><button aria-pressed={boundaryDecisions[boundary.id] === "not-a-boundary"} className={boundaryDecisions[boundary.id] === "not-a-boundary" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "not-a-boundary")}><b>{t("Keep inside the current chapter")}</b><small>{t("This heading will not create a chapter break.")}</small></button></div>
            {boundaries.length > 1 && !boundaries.every((row) => boundaryDecisions[row.id] === "chapter-start") && <div className="chapter-bulk-choice"><span><b>{t("Same decision for every heading?")}</b><small>{t("Mark all {{count}} detected headings as chapter starts. You can still change any one afterward.", { count: boundaries.length })}</small></span><button className="ghost review-bulk-button" onClick={acceptAllBoundaries}>{t("Mark all {{count}} as chapter starts", { count: boundaries.length })}</button></div>}
          </section>
        </> : warning && occurrence && actionWarning ? <>
          <section className="review-evidence">
            <div className="review-group-heading"><span><h2>{t(reviewWarningLabel(warning.kind))}</h2><p>{t(reviewGuidance(warning), { defaultValue: reviewGuidance(warning) })}</p></span>{warning.severity === "blocking" && <Tag tone="rose">{t("blocking")}</Tag>}</div>
            <div className="occurrence-meta"><b>{t("Example {{current}} of {{total}}", { current: activeOccurrence + 1, total: warning.occurrences.length })}</b><span>{t("Page {{page}}", { page: occurrence.page })}</span></div>
            <div className={hasCleanupSuggestion ? "source-window ai-cleanup-source" : "source-window"} aria-label={t("Manuscript context")}><div className="context-boundary">{t("Text immediately before")}</div>{occurrence.contextBefore ? <p className="context">{occurrence.contextBefore}</p> : <p className="context unavailable">{t("No earlier text is available in this preview.")}</p>}<p className="detected-span"><span>{t("Flagged text")}</span><mark>{occurrence.source || t("No text was extracted here")}</mark></p><div className="context-boundary">{t("Text immediately after")}</div>{occurrence.contextAfter ? <p className="context">{occurrence.contextAfter}</p> : <p className="context unavailable">{t("No later text is available in this preview.")}</p>}</div>
            {hasCleanupSuggestion && <div className="cleanup-proposal" aria-label={t("Proposed correction")}><b>{t("Proposed correction")}</b>{typeof occurrence.replacement === "string" ? occurrence.replacement === "" ? <p className="cleanup-deletion">{t("Remove the flagged text from the audiobook transcript.")}</p> : <p className="cleanup-replacement">{occurrence.replacement}</p> : <p>{t("No correction was proposed. Check the source before keeping or leaving out this text.")}</p>}{(occurrence.cleanupReason || occurrence.reason) && <p className="evidence-help">{t(userFacingDetail(occurrence.cleanupReason || occurrence.reason, "Compare the highlighted text with your source document."))}</p>}</div>}
            <p className="evidence-help">{t("Only the highlighted text changes. Surrounding text stays unchanged.")}</p>
            <div className="warning-nav"><button disabled={activeOccurrence === 0} onClick={() => setActiveOccurrence(activeOccurrence - 1)}>← {t("Previous example")}</button><button disabled={activeOccurrence >= warning.occurrences.length - 1} onClick={() => setActiveOccurrence(activeOccurrence + 1)}>{t("Next example")} →</button></div>
          </section>
          <section className="resolution-panel">
            <div className="review-scope"><b>{t(perOccurrence || warning.occurrences.length === 1 ? "Applies to this occurrence" : "Applies to all {{count}} occurrences in this group", { count: warning.occurrences.length })}</b><small>{t(perOccurrence ? "Each suggestion keeps its own decision. Changes apply when you accept the review." : "Review each example on the left before choosing once.")}</small></div>
            <h3>{t(hasCleanupSuggestion && typeof occurrence.replacement !== "string" ? "Does this text match the source?" : reviewQuestion(actionWarning.kind))}</h3>
            <div className="resolution-options">{occurrenceActions.filter((action) => !isAiCleanup || action === "keep" || action === "exclude").map((action) => <button key={action} aria-pressed={selectedAction === action} className={selectedAction === action ? "selected" : ""} onClick={() => perOccurrence ? chooseOccurrenceAction(action) : chooseReviewAction(warning.id, action)}><b>{t(reviewActionTitle(action, actionWarning))}</b><small>{reviewConsequence(action, actionWarning, t)}</small></button>)}{isAiCleanup && proposals.length > 0 && <button className="cleanup-bulk-warning" disabled={pendingProposalCount === 0} onClick={applyAllProposals}><span className="cleanup-bulk-title"><b>{t("Apply all AI suggestions")}</b><span aria-hidden="true">⚠</span></span><small>{t(pendingProposalCount === 1 ? "Apply 1 undecided AI suggestion. Your existing choices are preserved." : pendingProposalCount ? "Apply {{count}} undecided AI suggestions. Your existing choices are preserved." : "No undecided AI suggestions. Your existing choices are preserved.", { count: pendingProposalCount })}</small></button>}</div>
            {isAiCleanup && selectedAction === "repair" && <p className="cleanup-applied" role="status">{t("AI correction selected for this example. It will apply when you accept the review.")}</p>}
          </section>
        </> : null}
      </div>
      </div>
    </>}
    <div className="phase-action"><button className="primary" disabled={!complete || busy} onClick={() => { setReviewPreviewPage(1); setReviewFinalCheck(true); }}>{t("Review complete transcript")} →</button></div>
  </>;

}
