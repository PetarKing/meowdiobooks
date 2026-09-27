import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  DialogueAttributionTarget,
  DialogueConflict,
  DialogueRegex,
  DialogueStrategy,
  DialogueStructuralAction,
  DialogueStructuralIssue,
  ReviewTranscriptPreview,
  WizardStage
} from "../api/contracts";
import { PhaseHelp } from "../components/PhaseHelp";
import { Panel, Tag } from "../components/Ui";
import { StepIntro, WorkflowLaunch } from "../components/WorkflowPage";
import {
  type WizardStep
} from "../workflow/navigation";
import {
  reviewWarningLabel
} from "../workflow/review";
import type { DialogueConflictGroup } from "./helpers";

export function StepEyebrow({ stage, children }: { stage: WizardStep; children: ReactNode; }) {
  return <span className="step-eyebrow">{children}<PhaseHelp stage={stage} /></span>;
}

export function PageTitle({ stage, step, title, copy }: { stage: WizardStep; step: string; title: string; copy?: string; }) {
  return <StepIntro eyebrow={<StepEyebrow stage={stage}>{step}</StepEyebrow>} title={title} copy={copy} />;
}

export function StageLaunch({ children }: { children: ReactNode; }) {
  return <WorkflowLaunch>{children}</WorkflowLaunch>;
}

export function PageComparison({ imageUrl, imageAlt, imageZoom, imageControls, rightLabel, rightMeta, className = "", rightClassName = "", children }: {
  imageUrl?: string;
  imageAlt: string;
  imageZoom?: number;
  imageControls?: ReactNode;
  rightLabel: string;
  rightMeta?: ReactNode;
  className?: string;
  rightClassName?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return <div className={`compare extract-compare page-comparison ${className}`.trim()}>
    <div className="paper" tabIndex={0} role="region" aria-label={t("ORIGINAL PAGE")}>
      {imageControls ? <div className="paper-heading"><span>{t("ORIGINAL PAGE")}</span>{imageControls}</div> : <span>{t("ORIGINAL PAGE")}</span>}
      {imageUrl && (imageZoom
        ? <div className="pdf-preview-frame"><img src={imageUrl} alt={imageAlt} style={{ width: `${imageZoom}%` }} /></div>
        : <img src={imageUrl} alt={imageAlt} />)}
    </div>
    <div className={`extracted ${rightClassName}`.trim()} tabIndex={0} role="region" aria-label={rightLabel}><div className="page-comparison-heading"><span>{rightLabel}</span>{rightMeta}</div>{children}</div>
  </div>;
}

const reviewPdfZoomLevels = [60, 80, 100, 125, 150] as const;

export function ReviewTranscriptFinalCheck({ preview, loading, page, pageCount, busy, onPageChange, onBack, onAccept }: {
  preview?: ReviewTranscriptPreview;
  loading: boolean;
  page: number;
  pageCount: number;
  busy: boolean;
  onPageChange: (page: number) => void;
  onBack: () => void;
  onAccept: () => void;
}) {
  const { t } = useTranslation();
  const [pdfZoomIndex, setPdfZoomIndex] = useState(2);
  const safePageCount = Math.max(1, pageCount);
  const pdfZoom = reviewPdfZoomLevels[pdfZoomIndex];
  const changePage = (next: number) => onPageChange(Math.min(safePageCount, Math.max(1, next)));
  return <>
    <PageTitle stage="review" step={t("Step 3 · Final check")} title={t("Read it once like a listener.")} copy={t("Compare the PDF and audiobook transcript page by page. This preview does not change your book.")} />
    <section className="panel review-transcript-panel">
      <div className="transcript-page-control">
        <button type="button" aria-label={t("Previous transcript page")} disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}>←</button>
        <label><span>{t("Browse the whole book")}</span><input aria-label={t("Transcript preview page")} type="range" min="1" max={safePageCount} value={page} onChange={(event) => changePage(Number(event.target.value))} /></label>
        <output aria-live="polite">{page} / {safePageCount}</output>
        <button type="button" aria-label={t("Next transcript page")} disabled={page >= safePageCount || loading} onClick={() => changePage(page + 1)}>→</button>
      </div>
      <PageComparison imageUrl={preview?.imageUrl} imageAlt={t("Original PDF page {{page}}", { page: preview?.page ?? page })} imageZoom={pdfZoom} imageControls={<div className="pdf-zoom-controls" role="group" aria-label={t("PDF preview zoom")}>
        <button type="button" aria-label={t("Zoom out PDF preview")} disabled={pdfZoomIndex === 0} onClick={() => setPdfZoomIndex((current) => Math.max(0, current - 1))}>−</button>
        <output aria-live="polite">{pdfZoom}%</output>
        <button type="button" aria-label={t("Zoom in PDF preview")} disabled={pdfZoomIndex === reviewPdfZoomLevels.length - 1} onClick={() => setPdfZoomIndex((current) => Math.min(reviewPdfZoomLevels.length - 1, current + 1))}>+</button>
      </div>} rightLabel={t("AUDIOBOOK TRANSCRIPT")} rightMeta={<small>{loading ? t("Loading page {{page}}…", { page }) : t("Read-only preview")}</small>} rightClassName="review-transcript-pane" className={`review-transcript-compare ${loading ? "loading" : ""}`}>
        {preview?.spans.length ? <article aria-label={t("Audiobook transcript page {{page}}", { page: preview.page })} onCopy={(event) => event.preventDefault()}>
          {preview.spans.map((span) => <p key={span.id} className={`transcript-span ${span.reader === "Narrator" ? "narration" : span.kind}`}><b>{t(span.reader, { defaultValue: span.reader })}{span.kind === "excluded" && span.warningKind ? <small> · {t(reviewWarningLabel(span.warningKind))}</small> : null}</b><span>{span.text}</span></p>)}
        </article> : loading ? <div className="transcript-loading">{t("Opening the transcript…")}</div> : <div className="transcript-empty"><span aria-hidden="true">☾</span><b>{t("No spoken text on this page")}</b><small>{t("The source page may be blank or everything on it was excluded.")}</small></div>}
      </PageComparison>
    </section>
    <div className="phase-action transcript-final-action"><button type="button" className="ghost" onClick={onBack}>← {t("Back to decisions")}</button><span>{t("This is the last check before Cast & voices.")}</span><button type="button" className="primary" disabled={!preview || preview.page !== page || loading || busy} onClick={onAccept}>{t("Accept review and continue")} →</button></div>
  </>;
}

export function AcceptedSummary({ stage, step, title, receipt, note, onRevise, children }: { stage: Exclude<WizardStage, "import">; step: string; title: string; revision?: unknown; receipt?: string; note?: string; onRevise: () => void; children: ReactNode; }) {
  const { t } = useTranslation();
  const actions = <div className="accepted-summary-badges"><Tag tone="good">{t("Complete")}</Tag>{receipt && <span className="accepted-cost-receipt" title={t("Estimated API cost from provider-reported usage")}>{receipt}</span>}</div>;
  return <><PageTitle stage={stage} step={step} title={title} /><Panel variant="plain" actions={actions} title={t("Accepted settings")}><div className="accepted-summary">{children}</div><div className="summary-note">{note ?? t("Your accepted version stays in use until you approve a replacement.")}</div><div className="summary-actions"><span>{t("Accepted and ready for the next steps")}</span><button className="primary" onClick={onRevise}>{t("Change settings")} →</button></div></Panel></>;
}

export function DialogueStructuralReview({ issues, choices, onChoose, onApply }: { issues: DialogueStructuralIssue[]; choices: Record<string, DialogueStructuralAction>; onChoose: (issueId: string, action: DialogueStructuralAction) => void; onApply: () => void; }) {
  const { t } = useTranslation();
  const ready = issues.every((issue) => Boolean(choices[issue.id]));
  return <Panel eyebrow={t("Quick review")} title={issues.length === 1 ? t("1 interrupted dialogue turn needs your choice") : t("{{count}} interrupted dialogue turns need your choice", { count: issues.length })} actions={<Tag tone="warn">{t("Before AI")}</Tag>}><p className="panel-copy">{t("A new speaker label appears inside another detected line. Choose how to split the turns. The words stay unchanged.")}</p><div className="conflict-groups">{issues.map((issue, index) => {
    const selected = choices[issue.id];
    const split = issue.interpretations.split;
    const together = issue.interpretations["keep-together"];
    return <article className="conflict-group structural-issue" key={issue.id}><header><div className="conflict-group-heading"><small>{t("Interrupted turn {{number}}", { number: index + 1 })}</small><b>{t("Page {{page}}", { page: issue.page })}</b><span>{t("{{speaker}} contains a new {{inner}} turn", { speaker: issue.outerSpeakerLabel ?? t("Unknown speaker"), inner: issue.innerSpeakerLabels.join(", ") })}</span></div><div className="structural-choices" role="group" aria-label={t("Choose a result for interrupted turn {{number}}", { number: index + 1 })}><button className={selected === "split" ? "selected" : ""} onClick={() => onChoose(issue.id, "split")}><b>{t("Split into detected turns")}</b><small>{t("Each visible speaker reads their own line.")}</small></button><button className={selected === "keep-together" ? "selected" : ""} onClick={() => onChoose(issue.id, "keep-together")}><b>{t("Keep as one turn")}</b><small>{t("{{speaker}} reads the whole highlighted span.", { speaker: issue.outerSpeakerLabel ?? t("The first speaker") })}</small></button><button className={selected === "narration" ? "selected" : ""} onClick={() => onChoose(issue.id, "narration")}><b>{t("Leave as narration")}</b><small>{t("No speaker assignment is inferred here.")}</small></button></div></header><div className="conflict-example"><div className="conflict-source">{issue.contextBefore && <span>{issue.contextBefore}</span>}<mark>{issue.source}</mark>{issue.contextAfter && <span>{issue.contextAfter}</span>}</div><div className="conflict-result-label">{t("What this becomes")}</div><div className="structural-preview">{selected === "narration" ? <div className="selected"><b>{t("Narrator")}</b><span>{t("The highlighted source remains intact narration.")}</span></div> : (selected === "keep-together" ? together : split).map((claim) => <div key={claim.matchId} className={selected ? "selected" : ""}><b>{claim.speakerLabel ?? t("Speaker not identified")}</b><span>{claim.spokenText}</span></div>)}</div></div></article>;
  })}</div><div className="conflict-help">{t("Choices are recorded per interrupted turn. Nothing is repaired or rewritten silently.")}</div><div className="phase-action"><button className="primary" disabled={!ready} onClick={onApply}>{t("Apply choices and continue")} →</button></div></Panel>;
}

export function ResolvedStructuralIssues({ issues }: { issues: DialogueStructuralIssue[]; }) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  return <details className="resolved-conflicts"><summary><span><b>{t("Interrupted turns resolved")}</b><small>{t("{{count}} turns · source text preserved", { count: issues.length })}</small></span><Tag tone="good">{t("Resolved")}</Tag></summary><div className="resolved-conflicts-body">{issues.map((issue) => <div className="resolved-structural-row" key={issue.id}><b>{t("Page {{page}}", { page: issue.page })}</b><span>{issue.selectedAction === "split" ? t("Split into detected speaker turns") : issue.selectedAction === "keep-together" ? t("Kept as one {{speaker}} turn", { speaker: issue.outerSpeakerLabel ?? t("speaker") }) : t("Left as narration")}</span></div>)}</div></details>;
}

export function DialogueConflictReview({ groups, regexes, choices, onChoose, onReviewRules, onApply }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void; onReviewRules: () => void; onApply: () => void; }) {
  const { t } = useTranslation();
  const ready = groups.every((group) => Boolean(choices[group.groupId]));
  const total = groups.reduce((count, group) => count + group.conflicts.length, 0);
  return <Panel eyebrow={t("Quick review")} title={total === 1 ? t("1 overlapping dialogue match needs your choice") : t("{{count}} overlapping dialogue matches need your choice", { count: total })} actions={<Tag tone="warn">{t("Before AI")}</Tag>}><p className="panel-copy">{t("Two rules matched the same text. Choose which result to use for each group of overlaps. Both rules stay enabled.")}</p><DialogueConflictGroups groups={groups} regexes={regexes} choices={choices} onChoose={onChoose} /><div className="conflict-help">{t("Your choice applies only where these two rules overlap. Their other matches stay untouched.")}</div><div className="phase-action"><button className="ghost" onClick={onReviewRules}>{t("Review detection rules")}</button><button className="primary" disabled={!ready} onClick={onApply}>{t("Apply choices and continue")} →</button></div></Panel>;
}

export function DialogueRulesSection({ regexes, open, strategy, attributionTargets, onToggle, onToggleRegex, onAddRegex, onError }: { regexes: DialogueRegex[]; open: boolean; strategy: DialogueStrategy; attributionTargets: DialogueAttributionTarget[]; onToggle: () => void; onToggleRegex: (id: string, enabled: boolean) => void; onAddRegex: (regex: { label: string; pattern: string; flags: string; }) => Promise<boolean>; onError: (message: string) => void; }) {
  const { t } = useTranslation();
  const [regex, setRegex] = useState({ label: "", pattern: "", flags: "m" });
  const [submitting, setSubmitting] = useState(false);
  const matchingRegexes = regexes.filter((row) => row.matchCount > 0);
  const enabledCount = matchingRegexes.filter((row) => row.enabled).length;
  const customCount = matchingRegexes.filter((row) => !row.builtIn).length;
  async function addRegex() {
    if (!regex.label.trim() || !regex.pattern.trim()) return onError("Name and regex are required.");
    setSubmitting(true);
    try {
      if (await onAddRegex(regex)) setRegex({ label: "", pattern: "", flags: "m" });
    } finally {
      setSubmitting(false);
    }
  }
  return <section className={`advanced-section dialogue-rules-section ${open ? "open" : ""}`}>
    <button type="button" className="advanced-summary dialogue-rules-summary" aria-label={t("Dialogue detection rules")} aria-expanded={open} onClick={onToggle}>
      <span><b>{t("Dialogue detection rules")}</b><small>{t("{{matching}} matching · {{enabled}} enabled · {{builtIn}} built in · {{custom}} custom", { matching: matchingRegexes.length, enabled: enabledCount, builtIn: matchingRegexes.length - customCount, custom: customCount })}</small></span>
      <span>{t(open ? "Collapse" : "Review rules and examples")}</span>
    </button>
    {open && <div className="dialogue-rules-body">
      {matchingRegexes.length ? <div className="regex-results">{matchingRegexes.map((row) => <article className={row.enabled ? "" : "disabled"} key={row.id}>
        <label className="regex-toggle"><input type="checkbox" checked={row.enabled} onChange={(event) => onToggleRegex(row.id, event.target.checked)} /><span><strong>{t(row.label, { defaultValue: row.label })}</strong><small>{t("{{count}} matches · {{kind}}", { count: row.matchCount, kind: t(row.builtIn ? "built in" : "custom") })}</small>{row.label === "Unlabelled straight quotation" && <span className="regex-description">{t("Catches likely dialogue without speaker labels, including")} <q>{t("Alice says, “I’m late!”")}</q> {t("Review verifies uncertain matches before speech is generated.")}</span>}</span></label>
        <div className="regex-examples">{row.examples.slice(0, 3).map((example) => <div key={example.spanId}><small>{t("Page {{page}} · {{speaker}}", { page: example.page, speaker: example.speakerLabel ?? t("speaker not captured") })}</small><div className="regex-source-window">{example.contextBefore && <span>{example.contextBefore}</span>}<mark>{example.source}</mark>{example.contextAfter && <span>{example.contextAfter}</span>}</div>{example.speakerStatus === "unlabelled" ? strategy === "fill-gaps" && attributionTargets.includes("unlabelled-candidates") ? <b className="pending-ai">{t("Pending AI check")}</b> : <b>{t("Narrator will read: {{text}}", { text: example.spokenText })}</b> : <b>{t("Will speak: {{text}}", { text: example.spokenText })}</b>}</div>)}</div>
      </article>)}</div> : <div className="empty-dialogue"><b>{t("No likely dialogue was detected.")}</b><span>{t("The narrator will read the source unless you add a matching regex.")}</span></div>}
      <details className="dialogue-custom-builder"><summary><span><b>{t("Add a custom detection rule")}</b><small>{t("For a recurring source-specific format")}</small></span><span>{t("Advanced")}</span></summary><div><p className="panel-copy">{t("Use Python-style named captures:")} <code>(?P&lt;text&gt;...)</code> {t("and optionally")} <code>(?P&lt;speaker&gt;...)</code>.</p><div className="raw-regex-form"><label>{t("Name")}<input value={regex.label} onChange={(event) => setRegex({ ...regex, label: event.target.value })} /></label><label>{t("Regex")}<input value={regex.pattern} onChange={(event) => setRegex({ ...regex, pattern: event.target.value })} /></label><label>{t("Flags")}<input value={regex.flags} onChange={(event) => setRegex({ ...regex, flags: event.target.value })} /></label><button className="ghost" disabled={submitting} onClick={() => void addRegex()}>{t("Add and preview")}</button></div></div></details>
    </div>}
  </section>;
}

export function UnknownSpeakerLabelsSection({ patterns, onRemove, onAdd }: { patterns: string[]; onRemove: (pattern: string) => void; onAdd: (pattern: string) => void; }) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState("");
  return <section className="unknown-speaker-labels" aria-labelledby="unknown-speaker-labels-title"><div><b id="unknown-speaker-labels-title">{t("Labels that mean “speaker unknown”")}</b><small>{t("These source labels stay visible, but may be offered to AI for speaker identification.")}</small></div><div className="token-editor">{patterns.map((row) => <span key={row}><code>{row}</code><button aria-label={t("Remove {{label}}", { label: row })} onClick={() => onRemove(row)}>×</button></span>)}<input aria-label={t("Add unknown speaker pattern")} placeholder={t("Add another label pattern")} value={pattern} onChange={(event) => setPattern(event.target.value)} /><button className="ghost" onClick={() => { const next = pattern.trim(); if (!next) return; onAdd(next); setPattern(""); }}>{t("Add label")}</button></div></section>;
}

export function ResolvedDialogueConflicts({ groups, regexes, choices, onChoose, onApply }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void; onApply: () => void; }) {
  const { t } = useTranslation();
  if (!groups.length) return null;
  const total = groups.reduce((count, group) => count + group.conflicts.length, 0);
  return <details className="resolved-conflicts"><summary><span><b>{t("Regex overlaps resolved")}</b><small>{t("{{count}} matches · review or change before regenerating", { count: total })}</small></span><Tag tone="good">{t("Resolved")}</Tag></summary><div className="resolved-conflicts-body"><DialogueConflictGroups groups={groups} regexes={regexes} choices={choices} onChoose={onChoose} /><div className="phase-action"><button className="primary" disabled={!Object.keys(choices).length} onClick={onApply}>{t("Update choices")} →</button></div></div></details>;
}

export function DialogueConflictGroups({ groups, regexes, choices, onChoose }: { groups: DialogueConflictGroup[]; regexes: DialogueRegex[]; choices: Record<string, string>; onChoose: (groupId: string, profileId: string) => void; }) {
  const { t } = useTranslation();
  const labels = new Map(regexes.map((regex) => [regex.id, regex.label]));
  return <div className="conflict-groups">{groups.map((group) => {
    const selected = choices[group.groupId] ?? group.winnerProfileId;
    const overlapLabel = group.conflicts.length === 1 ? t("1 overlap") : t("{{count}} overlaps", { count: group.conflicts.length });
    const shownExamples = Math.min(group.conflicts.length, 4);
    return <article className="conflict-group" key={group.groupId}>
      <header>
        <div className="conflict-group-heading"><small>{t("This choice applies to")}</small><b>{t("{{overlaps}} total", { overlaps: overlapLabel })}</b><span>{group.conflicts.length <= 4 ? t("Showing all {{count}} examples", { count: shownExamples }) : t("Showing {{count}} representative examples", { count: shownExamples })}</span></div>
        <div className="conflict-choices" role="group" aria-label={t("Choose a result for {{count}} overlapping matches", { count: group.conflicts.length })}>
          {group.profileIds.map((profileId) => {
            const label = labels.get(profileId) ?? profileId;
            const isSelected = selected === profileId;
            return <button key={profileId} type="button" className={isSelected ? "selected" : ""} aria-label={t("Choose {{label}} for all {{overlaps}}", { label, overlaps: overlapLabel })} aria-pressed={isSelected} onClick={() => onChoose(group.groupId, profileId)}><span className="conflict-choice-radio" aria-hidden="true">{isSelected ? "✓" : ""}</span><span><b>{label}</b><small>{t(isSelected ? "Selected for all {{overlaps}}" : "Choose for all {{overlaps}}", { overlaps: overlapLabel })}</small></span></button>;
          })}
          <button type="button" className={selected === "narration" ? "selected" : ""} aria-label={t("Choose narration for all {{overlaps}}", { overlaps: overlapLabel })} aria-pressed={selected === "narration"} onClick={() => onChoose(group.groupId, "narration")}><span className="conflict-choice-radio" aria-hidden="true">{selected === "narration" ? "✓" : ""}</span><span><b>{t("Neither — leave as narration")}</b><small>{t(selected === "narration" ? "Selected for all {{overlaps}}" : "Choose for all {{overlaps}}", { overlaps: overlapLabel })}</small></span></button>
        </div>
      </header>
      <div className="conflict-examples">{group.conflicts.slice(0, 4).map((conflict, index) => <section key={conflict.id} className="conflict-example" aria-label={t("Overlap example {{number}}", { number: index + 1 })}>
        <div className="conflict-example-heading"><b>{t("Example {{number}} of {{count}} shown", { number: index + 1, count: shownExamples })}</b><small>{t("Page {{page}}", { page: conflict.page })}</small></div>
        <div className="conflict-source">{conflict.claims[0].contextBefore && <span>{conflict.claims[0].contextBefore}</span>}<mark>{conflict.claims[0].source}</mark>{conflict.claims[0].contextAfter && <span>{conflict.claims[0].contextAfter}</span>}</div>
        <div className="conflict-result-label">{t("What this becomes")}</div>
        <div className="conflict-interpretations">{group.profileIds.map((profileId) => conflict.claims.find((claim) => claim.profileId === profileId)).filter((claim): claim is DialogueConflict["claims"][number] => Boolean(claim)).map((claim) => {
          const isSelected = selected === claim.profileId;
          return <div key={claim.matchId} className={isSelected ? "selected" : ""}><header><b>{labels.get(claim.profileId) ?? claim.profileId}</b>{isSelected && <small>{t("Selected")}</small>}</header><dl><div><dt>{t("Detected speaker")}</dt><dd className={claim.speakerLabel ? "" : "muted"}>{claim.speakerLabel ?? t("Not identified")}</dd></div><div><dt>{t("Detected dialogue")}</dt><dd className="conflict-spoken-text">{claim.spokenText}</dd></div></dl></div>;
        })}{selected === "narration" && <div className="selected"><header><b>{t("Narrator")}</b><small>{t("Selected")}</small></header><dl><div><dt>{t("Result")}</dt><dd className="conflict-spoken-text">{t("Neither regex interpretation becomes a dialogue turn.")}</dd></div></dl></div>}</div>
      </section>)}</div>
      {group.conflicts.length > 4 && <small className="more-conflicts">{t("Showing 4 representative examples. This choice will apply to all {{count}} overlaps.", { count: group.conflicts.length })}</small>}
    </article>;
  })}</div>;
}

export function PdfCoverPageInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (page: number) => void; }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const parsed = Number(draft);
    const page = Number.isInteger(parsed) ? Math.min(max, Math.max(1, parsed)) : value;
    setDraft(String(page));
    onChange(page);
  }

  return <input
    aria-label={label}
    type="number"
    inputMode="numeric"
    min={1}
    max={max}
    step={1}
    value={draft}
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => {
      const next = event.target.value;
      setDraft(next);
      const parsed = Number(next);
      if (next !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= max) onChange(parsed);
    }}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
  />;
}
