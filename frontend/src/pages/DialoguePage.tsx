import type {
  DialogueConflictResolution,
  DialogueRegex,
  DialogueStructuralResolution
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { DialogueResultReview } from "../components/DialogueResultReview";
import { Panel } from "../components/Ui";
import { AcceptedSummary, DialogueConflictReview, DialogueRulesSection, DialogueStructuralReview, PageTitle, ResolvedDialogueConflicts, ResolvedStructuralIssues, UnknownSpeakerLabelsSection } from "../pages/shared";
import {
  availableAttributionTargets,
  candidateDialogue,
  dialogueRegexClaimCount,
  selectedAttributionCount,
  toggleTarget
} from "../workflow/dialogue";
import { formatApiCost, groupDialogueConflicts } from "./helpers";

export type DialoguePageModel = Pick<WorkflowModel, "acceptCandidate" | "attributionTargets" | "busy" | "capabilities" | "completed" | "conflictChoices" | "dialogue" | "dialogueCandidate" | "dialogueInitialDecisions" | "dialogueRulesOpen" | "dialogueStrategy" | "editingAcceptedDialogue" | "refreshDialogue" | "reopenAcceptedDialogueReview" | "requestDialogueTranscript" | "revisingStages" | "setAttributionTargets" | "setConflictChoices" | "setDialogue" | "setDialogueCandidate" | "setDialogueInitialDecisions" | "setDialogueRulesOpen" | "setDialogueStrategy" | "setEditingAcceptedDialogue" | "setError" | "setStructuralChoices" | "snapshot" | "structuralChoices" | "t">;

export function DialoguePage({ model }: { model: DialoguePageModel; }) {
  const { acceptCandidate, attributionTargets, busy, capabilities, completed, conflictChoices, dialogue, dialogueCandidate, dialogueInitialDecisions, dialogueRulesOpen, dialogueStrategy, editingAcceptedDialogue, refreshDialogue, reopenAcceptedDialogueReview, requestDialogueTranscript, revisingStages, setAttributionTargets, setConflictChoices, setDialogue, setDialogueCandidate, setDialogueInitialDecisions, setDialogueRulesOpen, setDialogueStrategy, setEditingAcceptedDialogue, setError, setStructuralChoices, snapshot, structuralChoices, t } = model;
  const successful = dialogue.regexes.filter((row) => row.matchCount > 0);
  const eligibleAttributionTargets = availableAttributionTargets(dialogue, attributionTargets);
  const unresolvedStructuralIssues = dialogue.structuralIssues ?? [];
  const resolvedStructuralIssues = dialogue.resolvedStructuralIssues ?? [];
  const unresolvedConflictGroups = groupDialogueConflicts(dialogue.conflicts ?? []);
  const resolvedConflictGroups = groupDialogueConflicts(dialogue.resolvedConflicts ?? []);
  const allConflictGroups = groupDialogueConflicts([...(dialogue.conflicts ?? []), ...(dialogue.resolvedConflicts ?? [])]);
  const result = dialogueCandidate ? candidateDialogue(dialogueCandidate, dialogue, dialogueStrategy) : undefined;
  const remoteCostReceipt = capabilities.showProviderCostReceipts && dialogue.remoteUsage
    ? `${dialogue.remoteUsage.modelDisplayName} · ≈${formatApiCost(dialogue.remoteUsage.estimatedCostUsd)} API`
    : undefined;
  const hasPreflightIssues = unresolvedStructuralIssues.length > 0 || unresolvedConflictGroups.length > 0;
  const conflictPairKey = (profileIds: [string, string]) => [...profileIds].sort().join("\u0000");
  function currentConflictResolutions() {
    const resolutions = new Map<string, DialogueConflictResolution>();
    for (const resolution of dialogue.conflictResolutions ?? []) resolutions.set(conflictPairKey(resolution.profileIds), resolution);
    for (const group of allConflictGroups) {
      const winnerProfileId = conflictChoices[group.groupId] ?? group.winnerProfileId;
      if (winnerProfileId) resolutions.set(conflictPairKey(group.profileIds), { profileIds: group.profileIds, winnerProfileId });
    }
    return [...resolutions.values()];
  }
  function currentStructuralResolutions() {
    const resolutions = new Map<string, DialogueStructuralResolution>();
    for (const resolution of dialogue.structuralResolutions ?? []) resolutions.set(resolution.issueId, resolution);
    for (const issue of [...unresolvedStructuralIssues, ...resolvedStructuralIssues]) {
      const action = structuralChoices[issue.id] ?? issue.selectedAction;
      if (action) resolutions.set(issue.id, { issueId: issue.id, action });
    }
    return [...resolutions.values()];
  }
  function updateRegex(id: string, update: Partial<DialogueRegex>) { const next = { ...dialogue, conflictResolutions: currentConflictResolutions(), structuralResolutions: currentStructuralResolutions(), regexes: dialogue.regexes.map((row) => row.id === id ? { ...row, ...update } : row) }; setConflictChoices({}); setStructuralChoices({}); setDialogue(next); void refreshDialogue(next); }
  function applyConflictResolutions() {
    const conflictResolutions = currentConflictResolutions();
    const resolvedPairs = new Set(conflictResolutions.map((row) => conflictPairKey(row.profileIds)));
    if (allConflictGroups.some((group) => !resolvedPairs.has(conflictPairKey(group.profileIds)))) return;
    const next = { ...dialogue, conflictResolutions };
    setConflictChoices({});
    setDialogue(next);
    void refreshDialogue(next);
  }
  function applyStructuralResolutions() {
    if (unresolvedStructuralIssues.some((issue) => !structuralChoices[issue.id])) return;
    const next = { ...dialogue, structuralResolutions: currentStructuralResolutions() };
    setStructuralChoices({});
    setDialogue(next);
    void refreshDialogue(next);
  }
  if (completed.includes("dialogue") && !dialogueCandidate && !revisingStages.includes("dialogue")) return <AcceptedSummary stage="dialogue" step={t("Step 2")} title={t("Transcript ready")} revision={snapshot?.activeArtifacts.dialogue} receipt={remoteCostReceipt} onRevise={() => void reopenAcceptedDialogueReview()}><span><b>{dialogue.summary.explicitTurns}</b><small>{t("Pre-labelled")}</small></span><span className="ai-contribution"><b>{dialogue.summary.aiContributions ?? 0}</b><small>{t("AI-assisted")} <em>{t("Kept after review")}</em></small></span><span><b>{dialogue.summary.userCorrected ?? 0}</b><small>{t("Corrected by you")}</small></span><span><b>{dialogue.summary.unresolved ?? 0}</b><small>{t("Narrator fallback")}</small></span></AcceptedSummary>;
  if (result) return <DialogueResultReview key={`${result.revision}:${editingAcceptedDialogue ? "accepted" : "candidate"}`} result={result} busy={busy} initialDecisions={dialogueInitialDecisions} requireChanges={editingAcceptedDialogue} onChangeStrategy={() => { setDialogueInitialDecisions([]); setEditingAcceptedDialogue(false); setDialogueCandidate(undefined); }} onAccept={(decisions) => void acceptCandidate("dialogue", dialogueCandidate, decisions.map((decision) => ({ ...decision })))} />;
  return <><PageTitle stage="dialogue" step={t("Step 2")} title={t("Build the transcript")} copy={t("Review detected dialogue and decide who reads anything unresolved.")} />
    {!result && (hasPreflightIssues ? <div className="dialogue-stats conflict-stats"><span><b>{dialogueRegexClaimCount(dialogue)}</b><small>{t("regex interpretations")}</small></span><span className="warn"><b>{unresolvedStructuralIssues.length + dialogue.summary.conflicts}</b><small>{t("issues to review")}</small></span><span><b>{t("Pending")}</b><small>{t("AI scope after review")}</small></span></div> : <div className="dialogue-stats"><span><b>{dialogue.summary.totalTurns}</b><small>{t("turns found")}</small></span><span><b>{dialogue.summary.explicitTurns}</b><small>{t("pre-labelled turns")}</small></span><span className={dialogue.summary.openSpeakerTurns ? "warn" : "good"}><b>{dialogue.summary.openSpeakerTurns}</b><small>{t("unknown labels")}</small></span><span className={dialogue.summary.unlabeledCandidates ? "warn" : "good"}><b>{dialogue.summary.unlabeledCandidates}</b><small>{t("dialogue without labels")}</small></span></div>)}

    {!result && !dialogueRulesOpen && unresolvedStructuralIssues.length > 0 && <DialogueStructuralReview issues={unresolvedStructuralIssues} choices={structuralChoices} onChoose={(issueId, action) => setStructuralChoices((current) => ({ ...current, [issueId]: action }))} onApply={applyStructuralResolutions} />}
    {!result && !dialogueRulesOpen && unresolvedStructuralIssues.length === 0 && unresolvedConflictGroups.length > 0 && <DialogueConflictReview groups={unresolvedConflictGroups} regexes={dialogue.regexes} choices={conflictChoices} onChoose={(groupId, profileId) => setConflictChoices((current) => ({ ...current, [groupId]: profileId }))} onReviewRules={() => setDialogueRulesOpen(true)} onApply={applyConflictResolutions} />}
    {!result && !dialogueRulesOpen && !hasPreflightIssues && <><ResolvedStructuralIssues issues={resolvedStructuralIssues} /><ResolvedDialogueConflicts groups={resolvedConflictGroups} regexes={dialogue.regexes} choices={conflictChoices} onChoose={(groupId, profileId) => setConflictChoices((current) => ({ ...current, [groupId]: profileId }))} onApply={applyConflictResolutions} /><Panel variant="plain" className="dialogue-choice-panel" eyebrow={t("Unresolved dialogue")} title={t("Who reads the unresolved dialogue?")}><p className="panel-copy scope-intro">{t("Let AI suggest speakers, or use Narrator for unresolved dialogue.")}</p><div className="strategy-list two"><div className={`strategy-card ${dialogueStrategy === "fill-gaps" ? "selected" : ""}`} onClick={() => setDialogueStrategy("fill-gaps")}><button type="button" aria-pressed={dialogueStrategy === "fill-gaps"} onClick={() => setDialogueStrategy("fill-gaps")}><strong>{t("Suggest speakers with AI")}</strong><small>{t("AI uses nearby text to suggest a speaker. Existing speaker labels stay unchanged.")}</small></button><fieldset className="attribution-scopes" disabled={dialogueStrategy !== "fill-gaps"}><legend>{t("Choose what AI may identify")}</legend><label className={dialogue.summary.unlabeledCandidates === 0 ? "unavailable" : undefined}><input type="checkbox" disabled={dialogue.summary.unlabeledCandidates === 0} checked={eligibleAttributionTargets.includes("unlabelled-candidates")} onChange={() => setAttributionTargets(toggleTarget(attributionTargets, "unlabelled-candidates"))} /><span><b>{t("Dialogue with no speaker label")}</b><small><strong className={dialogue.summary.unlabeledCandidates ? "scope-count warn" : "scope-count good"}>{dialogue.summary.unlabeledCandidates === 1 ? t("1 turn") : t("{{count}} turns", { count: dialogue.summary.unlabeledCandidates })}</strong> {t(dialogue.summary.unlabeledCandidates === 1 ? "was detected as speech, but the source does not say who speaks." : "were detected as speech, but the source does not say who speaks.")}</small><details className="scope-example"><summary>{t("Example")}</summary><q>{t("I knew you would come.")}</q></details></span></label><label className={dialogue.summary.openSpeakerTurns === 0 ? "unavailable" : undefined}><input type="checkbox" disabled={dialogue.summary.openSpeakerTurns === 0} checked={eligibleAttributionTargets.includes("open-speakers")} onChange={() => setAttributionTargets(toggleTarget(attributionTargets, "open-speakers"))} /><span><b>{t("Dialogue labelled as unknown")}</b><small><strong className={dialogue.summary.openSpeakerTurns ? "scope-count warn" : "scope-count good"}>{dialogue.summary.openSpeakerTurns === 1 ? t("1 turn") : t("{{count}} turns", { count: dialogue.summary.openSpeakerTurns })}</strong> {t(dialogue.summary.openSpeakerTurns === 1 ? "has a label that explicitly means the speaker is unknown." : "have a label that explicitly means the speaker is unknown.")}</small><details className="scope-example"><summary>{t("Example")}</summary><q>{t("???: Who goes there?")}</q></details></span></label></fieldset></div><div className={`strategy-card ${dialogueStrategy === "narrate" ? "selected" : ""}`} onClick={() => setDialogueStrategy("narrate")}><button type="button" aria-pressed={dialogueStrategy === "narrate"} onClick={() => setDialogueStrategy("narrate")}><strong>{t("Use the narrator")}</strong><small>{t("Narrator reads every unresolved line.")}</small></button><div className="narrator-outcome"><b>{t("Predictable fallback")}</b><span>{t("Dialogue with a known speaker keeps its assigned voice.")}</span></div></div></div><div className="dialogue-strategy-footer"><div className="strategy-consequence">{successful.length === 0 ? <><b>{t("No detected targets are available for AI attribution.")}</b><span>{t("Add a matching detection rule or continue with narrator-read source.")}</span></> : dialogueStrategy === "fill-gaps" ? <><b>{t("{{count}} detected turns will use AI.", { count: selectedAttributionCount(dialogue, eligibleAttributionTargets) })}</b><span>{t("{{unselected}} unselected turns will use the narrator; {{labelled}} pre-labelled turns stay unchanged.", { unselected: dialogue.summary.openSpeakerTurns + dialogue.summary.unlabeledCandidates - selectedAttributionCount(dialogue, eligibleAttributionTargets), labelled: dialogue.summary.explicitTurns })}</span></> : <><b>{t("No AI speaker matching will run.")}</b><span>{t("Narrator will read all unresolved dialogue.")}</span></>}</div><button className="primary" disabled={busy || (dialogueStrategy === "fill-gaps" && eligibleAttributionTargets.length === 0)} onClick={() => void requestDialogueTranscript()}>{t("Build transcript")} →</button></div></Panel></>}
    {!result && <><DialogueRulesSection regexes={dialogue.regexes} open={dialogueRulesOpen} strategy={dialogueStrategy} attributionTargets={attributionTargets} onToggle={() => setDialogueRulesOpen((open) => !open)} onToggleRegex={(id, enabled) => updateRegex(id, { enabled })} onAddRegex={async (regex) => { const next = { ...dialogue, regexes: [...dialogue.regexes, { id: `custom-${Date.now()}`, ...regex, priority: dialogue.regexes.length + 100, enabled: true, builtIn: false, matchCount: 0, examples: [] }] }; return refreshDialogue(next); }} onError={setError} />{dialogueRulesOpen && <UnknownSpeakerLabelsSection patterns={dialogue.openSpeakerPatterns} onRemove={(pattern) => { const next = { ...dialogue, openSpeakerPatterns: dialogue.openSpeakerPatterns.filter((row) => row !== pattern) }; setDialogue(next); void refreshDialogue(next); }} onAdd={(pattern) => { const next = { ...dialogue, openSpeakerPatterns: [...dialogue.openSpeakerPatterns, pattern] }; setDialogue(next); void refreshDialogue(next); }} />}</>}
  </>;

}
