import { type CSSProperties, type ReactNode } from "react";
import type { AppProps } from "./app/contracts";
import { useWorkflowModel } from "./app/useWorkflowModel";
import brandMark from "./assets/brand/meowdiobooks-mark.png";
import catWizardArtwork from "./assets/illustrations/cat-wizard-workflow.png";
import { DialogueRoutingChoice } from "./components/DialogueRoutingChoice";
import { LanguageToggle } from "./components/LanguageToggle";
import { PresentationRoot } from "./components/PresentationRoot";
import { CastPage } from "./pages/CastPage";
import { DialoguePage } from "./pages/DialoguePage";
import { DialogueRecoveryPage } from "./pages/DialogueRecoveryPage";
import { ExportPage } from "./pages/ExportPage";
import { ExtractPage } from "./pages/ExtractPage";
import { GeneratePage } from "./pages/GeneratePage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReviewPage } from "./pages/ReviewPage";
import {
  reconnectingJobMessage
} from "./workflow/jobPolling";
import {
  type ProductView,
  type WizardStep
} from "./workflow/navigation";
import {
  localizeErrorMessage,
  localizeProcessMessage,
  monogram
} from "./workflow/presentation";
export type { AppProps, WorkflowCapabilities, WorkflowHeaderContext, WorkflowStepOverrideProps } from "./app/contracts";

function ProductTabIcon({ view }: { view: ProductView; }) {
  if (view === "create") {
    return <svg className="product-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 4 5 5L9 20l-5-5L15 4Z" /><path d="m14 5 5 5M6 4v3M4.5 5.5h3M18 16v4M16 18h4" /></svg>;
  }
  return <svg className="product-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.5h5v14H4zM10 5.5h5v14h-5zM16.5 5l3.5-.8 2.6 13.6-3.5.8z" /></svg>;
}

export default function App(props: AppProps) {
  const model = useWorkflowModel(props);
  const { activeJob, activeJourneyStep, book, bookPendingDeletion, busy, cancelActiveJobLabel, cancelActiveStageJob, cancelRequestPending, capabilities, completed, deleteBook, deletingBookId, dialogue, dialogueLaunchPending, dialogueProcessing, dialogueProcessingRoute, dialogueRouteChoiceOpen, error, extractionTransition, gateway, generateComplete, generationInProgress, generationModalRef, generationReady, generationRemaining, generationRun, hasDraft, home, hydrate, libraryExports, navigateProduct, processMessage, processingOverlaySuppressed, productView, progress, recoveringDownstreamDialogue, renderHeader, reviewTransition, routeStage, runDialogueTranscript, setBookPendingDeletion, setDialogueRouteChoiceOpen, setHome, setStage, showCancelActiveJob, showWizard, sidebarCollapsed, snapshot, stage, stageIndex, stages, stepOverrides, t, toggleSidebar, unlockedThrough, uploadingCharacterId } = model;
  // Keep accepted-main invocation and mount boundaries during neutral extraction.
  // Page functions below are render-only and must not introduce hooks.
  const builtinViews: Partial<Record<WizardStep, ReactNode>> = {
    extract: ExtractPage({ model }),
    dialogue: DialoguePage({ model }),
    review: ReviewPage({ model }),
    cast: CastPage({ model }),
    generate: <GenerateStage key="generate" />,
    export: ExportPage({ model }),
  };

  const StepOverride = activeJourneyStep ? stepOverrides[activeJourneyStep.id] : undefined;

  const createView = home
    ? <Home />
    : StepOverride && activeJourneyStep
      ? <StepOverride
        step={activeJourneyStep}
        gateway={gateway}
        book={book}
        snapshot={snapshot}
        completedStages={completed}
        busy={busy}
        refresh={async () => { if (book) await hydrate(book.id); }}
        navigateToStep={(stepId) => {
          const requestedStage = stageIndex(stepId);
          setStage(routeStage(requestedStage));
        }}
      />
      : recoveringDownstreamDialogue
        ? DialogueRecoveryPage({ model })
        : activeJourneyStep?.builtin
          ? builtinViews[activeJourneyStep.builtin]
          : null;

  const view = productView === "create" ? createView : LibraryPage({ model });

  return <PresentationRoot className="app-shell" palette={props.presentationPalette}>
    {renderHeader ? renderHeader({ productView, libraryCount: libraryExports.length, navigate: navigateProduct }) : <header className="topbar" inert={generationInProgress || uploadingCharacterId ? true : undefined}>
      <div className="topbar-inner">
        <button className="brand" aria-label={t("Go to Home")} onClick={() => { navigateProduct("create"); setHome(true); }}>
          <span className="cat-mark"><img src={brandMark} alt="" /></span>
          <span>Meowdiobooks<small>{t("Books, finding their voice.")}</small></span>
        </button>
        <nav className="product-tabs" aria-label={t("Product areas")}>
          <button className={productView === "create" ? "active" : ""} onClick={() => navigateProduct("create")}><ProductTabIcon view="create" /><span className="product-tab-label">{t("Create")}</span></button>
          <button className={productView === "library" ? "active" : ""} aria-label={libraryExports.length ? t("Library, {{count}} audiobooks", { count: libraryExports.length }) : t("Library")} onClick={() => navigateProduct("library")}><ProductTabIcon view="library" /><span className="product-tab-label">{t("Library")}</span>{libraryExports.length > 0 && <small className="product-count" aria-hidden="true">{libraryExports.length}</small>}</button>
        </nav>
        <div className="topbar-actions">
          <LanguageToggle />
          {capabilities.showExecutionBadge && <div className="local-pill"><i /> {t("header.executionBadge", { ns: "edition" })}</div>}
        </div>
      </div>
    </header>}
    <div className={`workspace ${!showWizard ? "home-workspace" : ""} ${showWizard && sidebarCollapsed ? "rail-collapsed" : ""}`} inert={generationInProgress || uploadingCharacterId ? true : undefined}>
      {showWizard && <aside id="wizard-sidebar" className="rail" aria-label={t("Wizard stages")}>
        <button type="button" className="rail-toggle" aria-controls="wizard-sidebar" aria-expanded={!sidebarCollapsed} aria-label={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")} title={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span></button>
        <div className="book-mini"><div className="cover">{monogram(book?.title ?? "?")}</div><div><strong>{book?.title}</strong><span>{book?.filename}</span></div></div>
        <nav aria-label={t("Wizard stages")}>{stages.map((row, index) => { const done = row.builtin === "generate" ? generateComplete : Boolean(row.completionStage && completed.includes(row.completionStage)); const draft = hasDraft(row.builtin); const locked = index > unlockedThrough; const status = draft ? "Draft ready" : done ? "Complete" : stage === index ? "In progress" : "Ready"; const label = t(row.label); const previousLabel = t(stages[Math.max(0, index - 1)]?.label ?? ""); const localizedStatus = locked ? row.builtin === "export" ? t("Generate audio first") : t("Complete {{stage}} first", { stage: previousLabel }) : t(status); return <button key={row.id} disabled={locked} aria-label={`${label} ${localizedStatus}`} title={`${label} · ${localizedStatus}`} className={`${stage === index ? "active" : ""} ${done ? "done" : ""} ${draft ? "revising" : ""}`} onClick={() => setStage(routeStage(index))}><b>{done ? "✓" : locked ? "·" : index + 1}</b><span><strong>{label}</strong><small>{localizedStatus}</small></span></button>; })}</nav>
        <figure className="workflow-familiar" aria-label={t("Your wizard cat companion")}>
          <img src={catWizardArtwork} alt={t("A cat wizard guiding a manuscript into dialogue and sound")} />
        </figure>
      </aside>}
      <main className={!showWizard ? "home-main" : stage <= stageIndex("review") ? "review-wide" : ""}>
        {showWizard && activeJourneyStep && <div className="mobile-progress" role="status" aria-label={t("Workflow progress")}>
          <span>{t("Step {{current}} of {{total}} · {{stage}}", { current: stage + 1, total: stages.length, stage: t(activeJourneyStep.label) })}</span>
          <strong aria-hidden="true">{stage + 1} / {stages.length}</strong>
          <div aria-hidden="true"><i style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></div>
        </div>}
        {error && <div className="error-note" role="alert">{localizeErrorMessage(error, t)}</div>}
        {view}
      </main>
    </div>
    {dialogueRouteChoiceOpen && dialogue.routing && <DialogueRoutingChoice routing={dialogue.routing} onChoose={runDialogueTranscript} onClose={() => setDialogueRouteChoiceOpen(false)} />}
    {(((activeJob || dialogueLaunchPending) && !processingOverlaySuppressed && stage !== stageIndex("generate")) || extractionTransition || reviewTransition) && <div className="process-overlay" role="dialog" aria-label={t(dialogueProcessing && dialogueProcessingRoute === "remote" ? "processing.remoteDialogLabel" : "processing.dialogLabel", { ns: "edition" })} aria-modal="true"><div className={`process-modal ${dialogueProcessing ? "dialogue-processing-modal" : ""}`}><span className="eyebrow">{t(dialogueProcessing && dialogueProcessingRoute === "remote" ? "processing.remoteContextLabel" : "processing.contextLabel", { ns: "edition" })}</span><h2>{processMessage ? localizeProcessMessage(processMessage, t) : t("processing.fallbackMessage", { ns: "edition" })}</h2><div className={`processing-track determinate ${dialogueLaunchPending || activeJob?.status === "running" || extractionTransition || reviewTransition ? "active" : ""}`} style={{ "--progress": `${progress}%` } as CSSProperties} role="progressbar" aria-label={t("Processing progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div><p>{reviewTransition ? t("Saving your choices and opening Cast & voices…") : t("{{progress}}% complete · Accepted work stays unchanged.", { progress: Math.round(progress) })}</p>{showCancelActiveJob && !dialogueProcessing && <button className="ghost" disabled={cancelRequestPending || Boolean(activeJob?.cancel_requested_at)} onClick={() => void cancelActiveStageJob()}>{cancelActiveJobLabel}</button>}</div></div>}
    {uploadingCharacterId && <div className="process-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-clone-progress-title"><div className="process-modal"><span className="eyebrow">{t("processing.contextLabel", { ns: "edition" })}</span><h2 id="voice-clone-progress-title">{t("Creating cloned audition…")}</h2><div className="processing-track active" style={{ "--progress": "42%" } as CSSProperties} role="progressbar" aria-label={t("Cloned audition generation progress")}><i style={{ width: "42%" }} /></div><p>{t("voiceClone.progressDescription", { ns: "edition" })}</p></div></div>}
    {generationInProgress && <div className="process-overlay generation-overlay" role="dialog" aria-modal="true" aria-labelledby="generation-progress-title">
      <div ref={generationModalRef} className="process-modal generation-modal" tabIndex={-1}>
        <span className="eyebrow">{t("Making your audiobook")}</span>
        <h2 id="generation-progress-title">{t(processMessage === reconnectingJobMessage ? reconnectingJobMessage : progress >= 100 ? "Finishing your chapter audio…" : "Making your selected chapters…")}</h2>
        <div className={`processing-track determinate ${activeJob?.status === "running" ? "active" : ""}`} style={{ "--progress": `${progress}%` } as CSSProperties} role="progressbar" aria-label={t("Chapter generation progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
        <dl className="generation-progress-facts">
          <div><dt>{t("Chapters")}</dt><dd>{t("{{ready}} of {{total}} ready", { ready: generationReady, total: generationRun?.chapterIds.length ?? 0 })}</dd></div>
          <div><dt>{t("Remaining")}</dt><dd>{t(generationRemaining, { defaultValue: generationRemaining })}</dd></div>
        </dl>
        <p className="generation-modal-note">{t("processing.keepOpenNotice", { ns: "edition" })}</p>
        {showCancelActiveJob && <button className="ghost" disabled={cancelRequestPending || Boolean(activeJob?.cancel_requested_at)} onClick={() => void cancelActiveStageJob()}>{cancelActiveJobLabel}</button>}
      </div>
    </div>}
    {bookPendingDeletion && <div className="process-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-book-title"><div className="process-modal delete-book-modal"><span className="eyebrow">{t("books.deleteWorkingEyebrow", { ns: "edition" })}</span><h2 id="delete-book-title">{t("Delete “{{title}}”?", { title: bookPendingDeletion.title })}</h2><p>{t("books.deleteWorkingDescription", { ns: "edition" })}</p><p className="library-safe-note"><b>{t("Finished exports stay in Library.")}</b></p><div className="delete-book-actions"><button className="ghost" disabled={Boolean(deletingBookId)} onClick={() => setBookPendingDeletion(undefined)}>{t("Keep book")}</button><button className="danger" disabled={Boolean(deletingBookId)} onClick={() => void deleteBook(bookPendingDeletion)}>{t(deletingBookId ? "Deleting…" : "Delete working files")}</button></div></div></div>}
  </PresentationRoot>;

  function Home() { return <HomePage model={model} />; }
  function GenerateStage() { return <GeneratePage model={model} />; }
}
