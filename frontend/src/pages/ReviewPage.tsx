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
  message
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
} from "../workflow/review";

export type ReviewPageModel = Pick<WorkflowModel, "acceptCandidate" | "activeBoundary" | "activeOccurrence" | "activeReviewGroup" | "activeWarning" | "book" | "boundaryDecisions" | "busy" | "completed" | "gateway" | "processCandidate" | "reviewCandidate" | "reviewDecisions" | "reviewFinalCheck" | "reviewPreviewLoading" | "reviewPreviewPage" | "reviewStripRef" | "reviewTranscriptPreview" | "reviewTransition" | "revisingStages" | "setActiveBoundary" | "setActiveOccurrence" | "setActiveReviewGroup" | "setActiveWarning" | "setBoundaryDecisions" | "setError" | "setProcessMessage" | "setProgress" | "setReviewCandidate" | "setReviewDecisions" | "setReviewFinalCheck" | "setReviewPreviewPage" | "setReviewTransition" | "setRevisingStages" | "setStage" | "snapshot" | "stageIndex" | "t">;

export function ReviewPage({ model }: { model: ReviewPageModel; }) {
  const { acceptCandidate, activeBoundary, activeOccurrence, activeReviewGroup, activeWarning, book, boundaryDecisions, busy, completed, gateway, processCandidate, reviewCandidate, reviewDecisions, reviewFinalCheck, reviewPreviewLoading, reviewPreviewPage, reviewStripRef, reviewTranscriptPreview, reviewTransition, revisingStages, setActiveBoundary, setActiveOccurrence, setActiveReviewGroup, setActiveWarning, setBoundaryDecisions, setError, setProcessMessage, setProgress, setReviewCandidate, setReviewDecisions, setReviewFinalCheck, setReviewPreviewPage, setReviewTransition, setRevisingStages, setStage, snapshot, stageIndex, t } = model;
  const candidateWarnings = (reviewCandidate ? normalizeCandidateWarnings(reviewCandidate) : snapshot?.warnings ?? []).map((warning) => ({ ...warning, availableActions: reviewDecisionActions(warning) }));
  const boundaries = reviewCandidate && Array.isArray(reviewCandidate.boundaryCandidates) ? reviewCandidate.boundaryCandidates as WizardSnapshot["boundaryCandidates"] : snapshot?.boundaryCandidates ?? [];
  const warning = candidateWarnings[Math.min(activeWarning, Math.max(0, candidateWarnings.length - 1))];
  const occurrence = warning?.occurrences[Math.min(activeOccurrence, Math.max(0, warning.occurrences.length - 1))];
  const isAiCleanup = warning?.kind === "ai-cleanup";
  const selectedAction = occurrence && isAiCleanup ? reviewDecisions[occurrence.id] : warning && reviewDecisions[warning.id];
  const occurrenceActions = warning && occurrence ? reviewOccurrenceActions(warning, occurrence) : [];
  const proposalCount = isAiCleanup ? warning.occurrences.filter((row) => reviewOccurrenceActions(warning, row).includes("repair")).length : 0;
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
    if (!warning) return;
    const next = reviewProposalDecisions(warning, reviewDecisions);
    setReviewDecisions(next);
    const unresolved = warning.occurrences.findIndex((row) => !next[row.id]);
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
  if (!reviewCandidate) return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("Check for issues")} copy={t("Scan extraction, layout, chapter boundaries and delivery before choosing what happens.")} />
    <section className="review-scan-scene" aria-label={t("Manuscript review")}>
      <div className="review-scan-copy">
        <p>{t("This scan sends bounded passages to OpenAI Decisions and Luna to suggest cleanup corrections. You review every proposed change before it is applied.")}</p>
        {busy && <p>{t("Checking source words, chapter openings and reading order. Your accepted version remains available while we prepare a new review.")}</p>}
        {busy ? <div className="review-scan-progress" role="status" aria-label={t("Scanning for issues…")}><span className="review-scan-progress-track" aria-hidden="true"><i /></span>{t("Scanning for issues…")}</div>
          : <StageLaunch><button className="primary" onClick={() => void scanForIssues()}>{t("Scan for issues")} →</button></StageLaunch>}
      </div>
      <div className="review-scan-art" aria-hidden="true"><div className="review-scan-page"><i /><i /><i /><i /><i /><i /></div><div className="review-scan-stamp">✦</div></div>
    </section>
  </>;
  const recovery = reviewCandidate?.recovery;
  if (recovery) { const recoveryMessage = String(recovery.message ?? "Rebuild Dialogue before continuing."); return <><PageTitle stage="review" step={t("Step 3 · Review")} title={t("The transcript needs rebuilding before review.")} copy={t("Extraction completed successfully, but the transcript no longer maps back to every extracted character exactly.")} /><Panel eyebrow={t("Source safety check")} title={t("Nothing was lost or accepted incorrectly")} actions={<Tag tone="rose">{t("Needs rebuild")}</Tag>}><p className="panel-copy">{t(recoveryMessage, { defaultValue: recoveryMessage })}</p><div className="strategy-list two"><button className="strategy-card" onClick={() => { setRevisingStages([...new Set([...revisingStages, "dialogue"])]); setStage(stageIndex("dialogue")); }}><strong>{t("Rebuild Dialogue")}</strong><small>{t("Recommended. Keep the accepted extraction and create a fresh source-exact transcript.")}</small></button><button className="strategy-card" onClick={() => { setRevisingStages([...new Set([...revisingStages, "extract"])]); setStage(stageIndex("extract")); }}><strong>{t("Try another extraction")}</strong><small>{t("Use this only when the extracted words or reading order are themselves wrong.")}</small></button></div></Panel></>; }
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
    {totalGroups === 0 ? <WorkflowEmpty className="review-empty" symbol="✓" title={t("No warning groups")} copy={t("No chapter boundaries or source issues need a decision.")} /> : <>

      <div className="review-desk">
      <aside className="review-queue" aria-label={t("Decision queue")}>
        <div className="review-queue-heading"><span className="eyebrow">{t("Decision queue")}</span><b>{t("{{decided}} / {{total}} decided", { decided: decidedGroups, total: totalGroups })}</b></div>
        <nav className="review-strip" aria-label={t("Review groups")} ref={reviewStripRef}>
          {boundaries.length > 0 && <button data-review-group="chapters" className={[showingBoundary ? "active" : "", boundaries.every((row) => boundaryDecisions[row.id]) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openBoundary(activeBoundary)}><span>{boundaries.every((row) => boundaryDecisions[row.id]) ? "✓" : 1}</span><span><strong>{t("Chapter starts")}</strong><small>{t("{{count}} headings · structure", { count: boundaries.length })}</small></span></button>}
          {candidateWarnings.map((row, index) => <button key={row.id} data-review-group={`warning-${index}`} className={[!showingBoundary && index === activeWarning ? "active" : "", reviewWarningResolved(row, reviewDecisions) ? "resolved" : ""].filter(Boolean).join(" ")} onClick={() => openWarning(index)}><span>{reviewWarningResolved(row, reviewDecisions) ? "✓" : index + (boundaries.length ? 2 : 1)}</span><span><strong>{t(reviewWarningLabel(row.kind))}</strong><small>{t(row.occurrences.length === 1 ? "1 occurrence · {{severity}}" : "{{count}} occurrences · {{severity}}", { count: row.occurrences.length, severity: t(row.severity) })}</small></span></button>)}
        </nav>
      </aside>
      <div className={["review-workspace", showingBoundary ? "chapter-workspace" : "warning-workspace"].join(" ")}>
        {showingBoundary && boundary ? <>
          <section className="review-evidence chapter-review-evidence">
            <div className="review-group-heading"><span><h2>{t("Chapter starts")}</h2></span><Tag tone="good">{t("Structure")}</Tag></div>
            <div className="occurrence-meta"><b>{t("Heading {{current}} of {{total}}", { current: activeBoundary + 1, total: boundaries.length })}</b><span>{t("Page {{page}}", { page: boundary.page })}</span></div>
            <div className="chapter-heading-evidence" aria-label={t("Chapter heading evidence")}><span>{t("Candidate heading")}</span><i aria-hidden="true">✦</i><h3>{boundary.source}</h3><p>{t(boundary.reason ?? "Detected from an explicit standalone chapter heading.", { defaultValue: boundary.reason ?? t("Detected from an explicit standalone chapter heading.") })}</p></div>
            <p className="evidence-help">{t("This sets where the next audio chapter begins. The heading text stays unchanged.")}</p>
            <div className="warning-nav"><button disabled={activeBoundary === 0} onClick={() => setActiveBoundary(activeBoundary - 1)}>← {t("Previous heading")}</button><button disabled={activeBoundary >= boundaries.length - 1} onClick={() => setActiveBoundary(activeBoundary + 1)}>{t("Next heading")} →</button></div>
          </section>
          <section className="resolution-panel">
            <div className="review-scope"><b>{t("Applies to this heading only")}</b><small>{boundaries.length === 1 ? t("This is the only detected chapter heading.") : t("The other {{count}} candidates keep a separate decision.", { count: boundaries.length - 1 })}</small></div>
            <h3>{t("Does this heading start a new chapter?")}</h3>
            <div className="resolution-options" role="group" aria-label={t("Chapter decision for {{heading}}", { heading: boundary.source })}><button aria-pressed={boundaryDecisions[boundary.id] === "chapter-start"} className={boundaryDecisions[boundary.id] === "chapter-start" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "chapter-start")}><b>{t("Start a new chapter")}</b><small>{t("Audio before this heading stays in the previous chapter.")}</small></button><button aria-pressed={boundaryDecisions[boundary.id] === "not-a-boundary"} className={boundaryDecisions[boundary.id] === "not-a-boundary" ? "selected" : ""} onClick={() => chooseBoundaryAction(boundary.id, "not-a-boundary")}><b>{t("Keep inside the current chapter")}</b><small>{t("This heading will not create a chapter break.")}</small></button></div>
            {boundaries.length > 1 && !boundaries.every((row) => boundaryDecisions[row.id] === "chapter-start") && <div className="chapter-bulk-choice"><span><b>{t("Same decision for every heading?")}</b><small>{t("Mark all {{count}} detected headings as chapter starts. You can still change any one afterward.", { count: boundaries.length })}</small></span><button className="ghost review-bulk-button" onClick={acceptAllBoundaries}>{t("Mark all {{count}} as chapter starts", { count: boundaries.length })}</button></div>}
          </section>
        </> : warning && occurrence ? <>
          <section className="review-evidence">
            <div className="review-group-heading"><span><h2>{t(reviewWarningLabel(warning.kind))}</h2><p>{t(reviewGuidance(warning), { defaultValue: reviewGuidance(warning) })}</p></span><Tag tone={warning.severity === "blocking" ? "rose" : "warn"}>{t(warning.severity)}</Tag></div>
            <div className="occurrence-meta"><b>{t("Example {{current}} of {{total}}", { current: activeOccurrence + 1, total: warning.occurrences.length })}</b><span>{t("Page {{page}}", { page: occurrence.page })}</span></div>
            <div className={isAiCleanup ? "source-window ai-cleanup-source" : "source-window"} aria-label={t("Manuscript context")}><div className="context-boundary">{t("Text immediately before")}</div>{occurrence.contextBefore ? <p className="context">{occurrence.contextBefore}</p> : <p className="context unavailable">{t("No preceding text in this extraction window.")}</p>}<p className="detected-span"><span>{t("Flagged text")}</span><mark>{occurrence.source || t("No text was extracted here")}</mark></p><div className="context-boundary">{t("Text immediately after")}</div>{occurrence.contextAfter ? <p className="context">{occurrence.contextAfter}</p> : <p className="context unavailable">{t("No following text in this extraction window.")}</p>}</div>
            {isAiCleanup && <div className="cleanup-proposal" aria-label={t("Proposed correction")}><b>{t("Proposed correction")}</b>{typeof occurrence.replacement === "string" ? occurrence.replacement === "" ? <p className="cleanup-deletion">{t("Remove the flagged text from the audiobook transcript.")}</p> : <p className="cleanup-replacement">{occurrence.replacement}</p> : <p>{t("No correction was proposed. Check the source before keeping this text or trying extraction again.")}</p>}{occurrence.reason && <p className="evidence-help">{occurrence.reason}</p>}</div>}
            <p className="evidence-help">{t("Only the highlighted text changes. Surrounding text stays unchanged.")}</p>
            <div className="warning-nav"><button disabled={activeOccurrence === 0} onClick={() => setActiveOccurrence(activeOccurrence - 1)}>← {t("Previous example")}</button><button disabled={activeOccurrence >= warning.occurrences.length - 1} onClick={() => setActiveOccurrence(activeOccurrence + 1)}>{t("Next example")} →</button></div>
          </section>
          <section className="resolution-panel">
            <div className="review-scope"><b>{t(isAiCleanup || warning.occurrences.length === 1 ? "Applies to this occurrence" : "Applies to all {{count}} occurrences in this group", { count: warning.occurrences.length })}</b><small>{t(isAiCleanup ? "Each suggestion keeps its own decision. Changes apply when you accept the review." : "Review each example on the left before choosing once.")}</small></div>
            <h3>{t(isAiCleanup && typeof occurrence.replacement !== "string" ? "Does this text match the source?" : reviewQuestion(warning.kind))}</h3>
            <div className="resolution-options">{occurrenceActions.map((action) => <button key={action} aria-pressed={selectedAction === action} className={selectedAction === action ? "selected" : ""} onClick={() => isAiCleanup ? chooseOccurrenceAction(action) : chooseReviewAction(warning.id, action)}><b>{t(reviewActionTitle(action, warning))}</b><small>{reviewConsequence(action, isAiCleanup ? { ...warning, occurrences: [occurrence] } : warning, t)}</small></button>)}</div>
            {isAiCleanup && proposalCount > 0 && <div className="chapter-bulk-choice"><span><b>{t("Apply every proposed correction?")}</b><small>{t("Select all {{count}} corrections, including previously kept proposals. Suggestions without a correction still need a decision. You can change any choice before accepting the review.", { count: proposalCount })}</small></span><button className="ghost review-bulk-button" disabled={warning.occurrences.filter((row) => reviewOccurrenceActions(warning, row).includes("repair")).every((row) => reviewDecisions[row.id] === "repair")} onClick={applyAllProposals}>{t("Apply all {{count}} proposals", { count: proposalCount })}</button></div>}
          </section>
        </> : null}
      </div>
      </div>
    </>}
    <div className="phase-action"><button className="primary" disabled={!complete || busy} onClick={() => { setReviewPreviewPage(1); setReviewFinalCheck(true); }}>{t("Review complete transcript")} →</button></div>
  </>;

}
