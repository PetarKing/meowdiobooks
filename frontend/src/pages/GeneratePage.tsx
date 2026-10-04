import type { WorkflowModel } from "../app/useWorkflowModel";
import type { GenerationPurchasePresentation } from "../app/contracts";
import { DialogSurface } from "../components/DialogSurface";
import { DialogBackdrop } from "../components/DialogBackdrop";
import { TabList } from "../components/TabList";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { ChapterAudioPlayer } from "../components/ChapterAudioPlayer";
import { useFloatingActionDock } from "../components/useFloatingActionDock";
import type { ReactNode } from "react";
import { StepEyebrow } from "../pages/shared";
import {
  averageGenerationMultiplier,
  chapterDuration,
  generationDuration,
  longChapterSplitSeconds,
  targetChapterPartSeconds
} from "../workflow/generation";

export type GeneratePageModel = Pick<WorkflowModel, "gateway" | "book" | "busy" | "error" | "chapterFilter" | "continueToExport" | "generateChapters" | "generationEstimatePolicy" | "generationSamples" | "listeningChapterId" | "selectedChapters" | "setChapterFilter" | "setListeningChapterId" | "setSelectedChapters" | "setSplitChapterId" | "snapshot" | "splitChapterId" | "splitLongChapter" | "t">;

export function GeneratePage({ model, purchase }: { model: GeneratePageModel; purchase?: GenerationPurchasePresentation; }) {
  const { busy, error, chapterFilter, continueToExport, generateChapters, generationEstimatePolicy, generationSamples, listeningChapterId, selectedChapters, setChapterFilter, setListeningChapterId, setSelectedChapters, setSplitChapterId, snapshot, splitChapterId, splitLongChapter, t } = model;
  if (!snapshot?.recordingScript) return null;
  const generated = snapshot?.generatedChapters ?? [];
  const chapters = snapshot?.chapters ?? [];
  const scriptChapters = new Map(snapshot.recordingScript.summary.chapters.map((row) => [row.chapterId, row]));
  const unavailableChapters = new Set(snapshot.recordingScript.summary.emptyChapterIds);
  const purchasedChapters = new Set(
    purchase?.bookId === snapshot.book.id && snapshot.cast?.phase === "accepted" && purchase.castRevision === snapshot.cast.revision
      && purchase.extractionRevision === snapshot.activeArtifacts.extraction
      && purchase.dialogueRevision === snapshot.activeArtifacts.dialogue
      && purchase.reviewRevision === snapshot.activeArtifacts.review
      && purchase.castRevision === snapshot.activeArtifacts.cast
      && purchase.scriptRevision === (snapshot.recordingScript.revision ?? null)
      ? purchase.chapterIds
      : [],
  );
  const generatedByChapter = new Map(generated.map((row) => [row.chapterId, row]));
  const availableChapters = chapters.filter((chapter) => !unavailableChapters.has(chapter.id));
  const currentGenerated = generated.filter((row) => row.current);
  const exportSelected = chapterFilter === "generated" && selectedChapters.length > 0
    && selectedChapters.every((id) => generatedByChapter.get(id)?.current);
  const historicalMultiplier = averageGenerationMultiplier(generationSamples);
  const remainingAudioSeconds = availableChapters
    .filter((chapter) => !generatedByChapter.get(chapter.id)?.current)
    .reduce((total, chapter) => total + (scriptChapters.get(chapter.id)?.estimatedSeconds ?? (chapter.estimatedCharacters ?? 0) / 15), 0);
  const selectedAudioSeconds = chapters
    .filter((chapter) => selectedChapters.includes(chapter.id))
    .reduce((total, chapter) => total + (scriptChapters.get(chapter.id)?.estimatedSeconds ?? (chapter.estimatedCharacters ?? 0) / 15), 0);
  const visibleChapters = chapters.filter((chapter) => {
    const playable = generatedByChapter.get(chapter.id);
    if (chapterFilter === "pending") return !playable?.current && !unavailableChapters.has(chapter.id);
    if (chapterFilter === "generated") return Boolean(playable);
    return true;
  });
  const visibleAvailableChapterIds = visibleChapters.filter((chapter) => !unavailableChapters.has(chapter.id)).map((chapter) => chapter.id);
  const filterCounts = {
    all: chapters.length,
    pending: availableChapters.filter((chapter) => !generatedByChapter.get(chapter.id)?.current).length,
    generated: generated.length,
  };
  const listeningChapter = listeningChapterId ? chapters.find((chapter) => chapter.id === listeningChapterId) : undefined;
  const listeningAudio = listeningChapter ? generatedByChapter.get(listeningChapter.id) : undefined;
  const selectedLongChapter = selectedChapters.length === 1
    ? chapters.find((chapter) => chapter.id === selectedChapters[0])
    : undefined;
  const selectedLongSeconds = selectedLongChapter
    ? scriptChapters.get(selectedLongChapter.id)?.estimatedSeconds ?? (selectedLongChapter.estimatedCharacters ?? 0) / 15
    : 0;
  const canSplitSelectedChapter = Boolean(
    selectedLongChapter
    && !selectedLongChapter.splitFrom
    && selectedLongSeconds >= longChapterSplitSeconds
    && !generatedByChapter.get(selectedLongChapter.id)?.current,
  );
  const splitChapter = splitChapterId ? chapters.find((chapter) => chapter.id === splitChapterId) : undefined;
  const splitSeconds = splitChapter
    ? scriptChapters.get(splitChapter.id)?.estimatedSeconds ?? (splitChapter.estimatedCharacters ?? 0) / 15
    : 0;
  const proposedPartCount = Math.max(2, Math.ceil(splitSeconds / targetChapterPartSeconds));
  const selectFilter = (filter: typeof chapterFilter) => {
    setChapterFilter(filter);
    setSelectedChapters([]);
  };
  return <>
    <section className="generate-hero">
      <div className="generate-hero-copy">
        <StepEyebrow stage="generate">{t("Step 5 · Generate")}</StepEyebrow>
        <h1>{t("Record your chapters")}</h1>
        <p>{t("Each selected chapter becomes its own audio track to review before export.")}</p>
      </div>
      <div className="generate-hero-state"><dl className="generate-hero-stats">
        <div><dt>{t("Playable")}</dt><dd>{currentGenerated.length} <small>{t("of {{count}}", { count: availableChapters.length })}</small></dd></div>
        <div><dt>{t("Audio to make")}</dt><dd className={!filterCounts.pending ? "is-complete" : undefined}>{filterCounts.pending ? chapterDuration(remainingAudioSeconds) : t("None remaining")}</dd></div>
        <div><dt>{t("Still to make")}</dt><dd>{filterCounts.pending} <small>{t(filterCounts.pending === 1 ? "chapter" : "chapters")}</small></dd></div>
      </dl></div>
    </section>

    <section className="chapter-library" aria-label={t("Chapters")}>
      <div className="chapter-library-toolbar">
        <TabList label={t("Filter chapters")} className="chapter-filter-tabs" panelId="chapter-filter-panel" value={chapterFilter} onChange={selectFilter} items={[
          { value: "all", label: <>{t("All")} <small>{filterCounts.all}</small></> },
          { value: "pending", label: <>{t("To make")} <small>{filterCounts.pending}</small></> },
          { value: "generated", label: <>{t("Generated")} <small>{filterCounts.generated}</small></> },
        ]} />
        <div className="chapter-library-controls">
          <span>{t("{{count}} shown", { count: visibleChapters.length })}</span>
          <button type="button" onClick={() => setSelectedChapters(visibleAvailableChapterIds)}>{t("Select all shown")}</button>
          <button type="button" disabled={!selectedChapters.length} onClick={() => setSelectedChapters([])}>{t("Clear")}</button>
        </div>
      </div>
      <div id="chapter-filter-panel" role="tabpanel" aria-labelledby={`chapter-filter-panel-${chapterFilter}`} className={`chapter-card-grid ${selectedChapters.length ? "has-selection" : ""}`}>{visibleChapters.map((row) => {
        const playable = generatedByChapter.get(row.id);
        const unavailable = unavailableChapters.has(row.id);
        const purchased = !unavailable && purchasedChapters.has(row.id);
        const selected = !unavailable && selectedChapters.includes(row.id);
        const chapterNumber = chapters.findIndex((chapter) => chapter.id === row.id) + 1;
        const nextChapter = chapters[chapterNumber];
        const inferredEndPage = row.endPage ?? (nextChapter?.startPage ? nextChapter.startPage - 1 : snapshot?.book.pageCount);
        const pageRange = row.startPage ? t("Pages {{start}}–{{end}}", { start: row.startPage, end: Math.max(row.startPage, inferredEndPage ?? row.startPage) }) : undefined;
        const estimatedSeconds = scriptChapters.get(row.id)?.estimatedSeconds ?? (row.estimatedCharacters ?? 0) / 15;
        const audioSeconds = playable?.audioSeconds ?? estimatedSeconds;
        return <article key={row.id} className={`chapter-card ${selected ? "selected" : ""} ${purchased ? "purchased" : ""} ${playable?.current ? "generated" : ""} ${playable ? "has-audio" : ""} ${playable && !playable.current ? "stale" : ""} ${unavailable ? "unavailable" : ""}`}>
          {/* The native label is the whole track target. Listen stays its own sibling action. */}
          <label className="chapter-select chapter-row-target">
            <input aria-label={t("Select {{title}}", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} type="checkbox" disabled={unavailable} checked={selected} onChange={(event) => setSelectedChapters(event.target.checked ? [...new Set([...selectedChapters, row.id])] : selectedChapters.filter((id) => id !== row.id))} />
          </label>
          <div className="chapter-track-number">
            <b aria-hidden="true">{String(chapterNumber).padStart(2, "0")}</b>
          </div>
          {playable && <button type="button" className="chapter-listen" aria-label={t(playable.current ? "Listen to {{title}}" : "Listen to {{title}} (older recording)", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} onClick={() => setListeningChapterId(row.id)}>▶</button>}
          <div className="chapter-card-body">
            <h3 aria-level={2}>{row.title || t("Chapter {{number}}", { number: chapterNumber })}</h3>
            <div className="chapter-card-meta"><span className={`track-status ${playable?.current ? "ready" : unavailable ? "unavailable" : ""}`}>{t(unavailable ? "No audio" : playable?.current ? "Playable" : playable ? "Older recording" : "To make")}</span>{purchased && <span className="chapter-purchased-label"><span aria-hidden="true">✦</span>{t("Purchased")}</span>}{pageRange && <small>{pageRange}</small>}{playable && !playable.current && <span className="chapter-stale-label">{t("Stale")}</span>}</div>
          </div>
          <dl className="chapter-estimates"><div><dt>{t("Listening")}</dt><dd>{unavailable ? t("No audio") : chapterDuration(audioSeconds, !playable?.audioSeconds)}</dd></div><div><dt>{t("Generation")}</dt><dd>{unavailable ? t("Not needed") : generationDuration(estimatedSeconds, historicalMultiplier, generationEstimatePolicy)}</dd></div></dl>
        </article>;
      })}</div>
      {!visibleChapters.length && <WorkflowEmpty className="chapter-filter-empty" symbol="♪" title={t("No chapters in this view.")} copy={t("Choose another filter to see the rest of the book.")} />}
      {(availableChapters.length > 0 || currentGenerated.length > 0) && <GenerationActionDock ariaLabel={t("Generation action")}>
        {error && <p className="generation-error"><b>{t("Generation needs attention")}</b><span>{t(error, { defaultValue: error })}</span></p>}
        <div className="generation-selection-copy"><span className="selection-spark" aria-hidden="true">{selectedChapters.length ? "✦" : "♪"}</span><b>{selectedChapters.length ? selectedChapters.length === 1 ? t("1 chapter selected") : t("{{count}} chapters selected", { count: selectedChapters.length }) : currentGenerated.length ? currentGenerated.length === 1 ? t("1 chapter is ready") : t("{{count}} chapters are ready", { count: currentGenerated.length }) : t("Choose chapters to generate")}</b></div>
        {selectedChapters.length > 0 && <dl><div><dt>{t("Listening")}</dt><dd>{chapterDuration(selectedAudioSeconds)}</dd></div>{!exportSelected && <div><dt>{t("Generation")}</dt><dd>{generationDuration(selectedAudioSeconds, historicalMultiplier, generationEstimatePolicy)}</dd></div>}</dl>}
        <div className="generation-selection-actions">
          {canSplitSelectedChapter && <button className="chapter-split-button" type="button" aria-label={t("Split {{title}} into shorter chapters", { title: selectedLongChapter?.title || t("long chapter") })} onClick={() => setSplitChapterId(selectedLongChapter?.id)}><span aria-hidden="true">↯</span><span>{t("Split this into shorter chapters?")}</span></button>}
          {selectedChapters.length > 0 && currentGenerated.length > 0 && <button className="ghost" type="button" disabled={busy} onClick={() => exportSelected ? void generateChapters(selectedChapters) : continueToExport()}>{exportSelected ? t("Generate {{count}} selected", { count: selectedChapters.length }) : t("Continue to Export")}</button>}
          <button className="primary" disabled={busy || (!selectedChapters.length && !currentGenerated.length)} onClick={() => exportSelected ? continueToExport(selectedChapters) : selectedChapters.length ? void generateChapters(selectedChapters) : continueToExport()}>{busy ? t("Generating…") : exportSelected ? `${t("Continue to Export")} →` : selectedChapters.length ? `${t("Generate {{count}} selected", { count: selectedChapters.length })} →` : currentGenerated.length ? `${t("Continue to Export")} →` : t("Select chapters above")}</button>
        </div>
      </GenerationActionDock>}
    </section>

    {splitChapter && <DialogBackdrop className="chapter-player-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSplitChapterId(undefined); }}>
      <DialogSurface className="chapter-split-modal" aria-labelledby="chapter-split-title" onDismiss={busy ? undefined : () => setSplitChapterId(undefined)}>
        <button type="button" className="chapter-player-close" aria-label={t("Close chapter split")} disabled={busy} onClick={() => setSplitChapterId(undefined)}>×</button>
        <div className="chapter-split-heading"><span aria-hidden="true">↯</span><div><span className="eyebrow">{t("Long chapter")}</span><h2 id="chapter-split-title">{t("Split this into shorter chapters?")}</h2></div></div>
        <p>{t("{{title}} has {{duration}} of audio. It will become approximately {{count}} ordinary chapters around 30 minutes each.", { title: splitChapter.title, duration: chapterDuration(splitSeconds), count: proposedPartCount })}</p>
        <div className="chapter-split-facts"><span><b>{t("≈ {{count}} chapters", { count: proposedPartCount })}</b><small>{t("Usually 25–35 min each")}</small></span><span><b>{t("Safe text breaks")}</b><small>{t("Never inside a speech section")}</small></span></div>
        <p className="chapter-split-note">{t("The original item will be replaced. Review, cast and voices stay unchanged.")}</p>
        <div className="chapter-split-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setSplitChapterId(undefined)}>{t("Cancel")}</button><button className="primary" type="button" disabled={busy} onClick={() => void splitLongChapter(splitChapter.id)}>{busy ? t("Splitting…") : t("Split into ≈ {{count}} chapters", { count: proposedPartCount })}</button></div>
      </DialogSurface>
    </DialogBackdrop>}

    {listeningChapter && listeningAudio && <DialogBackdrop className="chapter-player-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setListeningChapterId(undefined); }}>
      <DialogSurface className="chapter-player-modal" aria-labelledby="chapter-player-title" onDismiss={() => setListeningChapterId(undefined)}>
        <button type="button" className="chapter-player-close" aria-label={t("Close player")} onClick={() => setListeningChapterId(undefined)}>×</button>
        <div className="chapter-player-book" aria-hidden="true"><span>{t("Chapter")}</span><b>{String(chapters.findIndex((chapter) => chapter.id === listeningChapter.id) + 1).padStart(2, "0")}</b><i>♪</i></div>
        <div className="chapter-player-copy"><span className="eyebrow">{t(listeningAudio.current ? "Chapter audio" : "Older recording")}</span><h2 id="chapter-player-title">{listeningChapter.title || t("Untitled chapter")}</h2></div>
        <ChapterAudioPlayer src={listeningAudio.audioUrl} />
      </DialogSurface>
    </DialogBackdrop>}
  </>;

}

function GenerationActionDock({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  const { anchorRef, floating } = useFloatingActionDock();
  return <>
    <span ref={anchorRef} className="generation-selection-anchor" aria-hidden="true" />
    <section className={`generation-selection${floating ? " is-floating" : ""}`} aria-label={ariaLabel}>{children}</section>
  </>;
}
