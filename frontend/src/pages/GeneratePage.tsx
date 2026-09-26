import { sourcePageImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { DialogSurface } from "../components/DialogSurface";
import { TabList } from "../components/TabList";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { ChapterAudioPlayer } from "../components/ChapterAudioPlayer";
import { StepEyebrow } from "../pages/shared";
import {
  averageGenerationMultiplier,
  chapterDuration,
  generationDuration,
  longChapterSplitSeconds,
  targetChapterPartSeconds
} from "../workflow/generation";

export type GeneratePageModel = Pick<WorkflowModel, "gateway" | "book" | "busy" | "chapterFilter" | "generateChapters" | "generationEstimatePolicy" | "generationSamples" | "listeningChapterId" | "selectedChapters" | "setChapterFilter" | "setListeningChapterId" | "setSelectedChapters" | "setSplitChapterId" | "setStage" | "snapshot" | "splitChapterId" | "splitLongChapter" | "stageIndex" | "t">;

export function GeneratePage({ model }: { model: GeneratePageModel; }) {
  const { gateway, book, busy, chapterFilter, generateChapters, generationEstimatePolicy, generationSamples, listeningChapterId, selectedChapters, setChapterFilter, setListeningChapterId, setSelectedChapters, setSplitChapterId, setStage, snapshot, splitChapterId, splitLongChapter, stageIndex, t } = model;
  if (!snapshot?.recordingScript) return null;
  const generated = snapshot?.generatedChapters ?? [];
  const chapters = snapshot?.chapters ?? [];
  const scriptChapters = new Map(snapshot.recordingScript.summary.chapters.map((row) => [row.chapterId, row]));
  const unavailableChapters = new Set(snapshot.recordingScript.summary.emptyChapterIds);
  const generatedByChapter = new Map(generated.map((row) => [row.chapterId, row]));
  const availableChapters = chapters.filter((chapter) => !unavailableChapters.has(chapter.id));
  const currentGenerated = generated.filter((row) => row.current);
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
  const coverUrl = book ? sourcePageImageUrl(gateway, book.id, 1) : undefined;
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
      <div className="generate-cover-stack" aria-hidden="true">
        <span />
        <span />
        {coverUrl && <img src={coverUrl} alt="" />}
      </div>
      <div className="generate-hero-copy">
        <StepEyebrow stage="generate">{t("Step 5 · Generate")}</StepEyebrow>
        <h1>{t("Bring every chapter to life.")}</h1>
        <p>{t("Each selected chapter becomes its own audio track to review before export.")}</p>
      </div>
      <div className="generate-hero-state"><dl className="generate-hero-stats">
        <div><dt>{t("Playable")}</dt><dd>{currentGenerated.length} <small>{t("of {{count}}", { count: availableChapters.length })}</small></dd></div>
        <div><dt>{t("Audio to make")}</dt><dd>{chapterDuration(remainingAudioSeconds)}</dd></div>
        <div><dt>{t("Still to make")}</dt><dd>{filterCounts.pending} <small>{t("chapters")}</small></dd></div>
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
        const selected = !unavailable && selectedChapters.includes(row.id);
        const chapterNumber = chapters.findIndex((chapter) => chapter.id === row.id) + 1;
        const nextChapter = chapters[chapterNumber];
        const inferredEndPage = row.endPage ?? (nextChapter?.startPage ? nextChapter.startPage - 1 : snapshot?.book.pageCount);
        const pageRange = row.startPage ? t("Pages {{start}}–{{end}}", { start: row.startPage, end: Math.max(row.startPage, inferredEndPage ?? row.startPage) }) : undefined;
        const estimatedSeconds = scriptChapters.get(row.id)?.estimatedSeconds ?? (row.estimatedCharacters ?? 0) / 15;
        const audioSeconds = playable?.audioSeconds ?? estimatedSeconds;
        return <article key={row.id} className={`chapter-card ${selected ? "selected" : ""} ${playable?.current ? "generated" : ""} ${playable ? "has-audio" : ""} ${playable && !playable.current ? "stale" : ""} ${unavailable ? "unavailable" : ""}`}>
          <label className="chapter-select">
            <input aria-label={t("Select {{title}}", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} type="checkbox" disabled={unavailable} checked={selected} onChange={(event) => setSelectedChapters(event.target.checked ? [...new Set([...selectedChapters, row.id])] : selectedChapters.filter((id) => id !== row.id))} />
          </label>
          <div className="chapter-book-mark">
            <span aria-hidden="true">{t("Chapter")}</span><b aria-hidden="true">{String(chapterNumber).padStart(2, "0")}</b>
            {playable && <button type="button" className="chapter-listen" aria-label={t(playable.current ? "Listen to {{title}}" : "Listen to {{title}} (older recording)", { title: row.title || t("Chapter {{number}}", { number: chapterNumber }) })} onClick={() => setListeningChapterId(row.id)}>▶</button>}
          </div>
          <div className="chapter-card-body">
            <h3 aria-level={2}>{row.title || t("Chapter {{number}}", { number: chapterNumber })}</h3>
            <div className="chapter-card-meta">{pageRange && <small>{pageRange}</small>}{playable && !playable.current && <span className="chapter-stale-label">{t("Stale")}</span>}</div>
          </div>
          <dl className="chapter-estimates"><div><dt>{t("Audio")}</dt><dd>{unavailable ? t("No audio") : chapterDuration(audioSeconds, !playable?.audioSeconds)}</dd></div><div><dt>{t("Make")}</dt><dd>{unavailable ? t("Not needed") : generationDuration(estimatedSeconds, historicalMultiplier, generationEstimatePolicy)}</dd></div></dl>
        </article>;
      })}</div>
      {!visibleChapters.length && <WorkflowEmpty className="chapter-filter-empty" symbol="♪" title={t("No chapters in this view.")} copy={t("Choose another filter to see the rest of the book.")} />}
      {(availableChapters.length > 0 || currentGenerated.length > 0) && <section className="generation-selection" aria-label={t("Generation action")}>
        <div className="generation-selection-copy"><span className="selection-spark" aria-hidden="true">{selectedChapters.length ? "✦" : "♪"}</span><b>{selectedChapters.length ? selectedChapters.length === 1 ? t("1 chapter selected") : t("{{count}} chapters selected", { count: selectedChapters.length }) : currentGenerated.length ? t("{{count}} chapters are ready", { count: currentGenerated.length }) : t("Choose chapters to generate")}</b></div>
        {selectedChapters.length > 0 && <dl><div><dt>{t("Listening")}</dt><dd>{chapterDuration(selectedAudioSeconds)}</dd></div><div><dt>{t("Generation")}</dt><dd>{generationDuration(selectedAudioSeconds, historicalMultiplier, generationEstimatePolicy)}</dd></div></dl>}
        <div className="generation-selection-actions">
          {canSplitSelectedChapter && <button className="chapter-split-button" type="button" aria-label={t("Split {{title}} into shorter chapters", { title: selectedLongChapter?.title || t("long chapter") })} onClick={() => setSplitChapterId(selectedLongChapter?.id)}><span aria-hidden="true">↯</span><span>{t("Split this into shorter chapters?")}</span></button>}
          {selectedChapters.length > 0 && currentGenerated.length > 0 && <button className="ghost" type="button" onClick={() => setStage(stageIndex("export"))}>{t("Continue to Export")}</button>}
          <button className="primary" disabled={busy || (!selectedChapters.length && !currentGenerated.length)} onClick={() => selectedChapters.length ? void generateChapters(selectedChapters) : setStage(stageIndex("export"))}>{busy ? t("Generating…") : selectedChapters.length ? `${t("Generate {{count}} selected", { count: selectedChapters.length })} →` : currentGenerated.length ? `${t("Continue to Export")} →` : t("Select chapters above")}</button>
        </div>
      </section>}
    </section>

    {splitChapter && <div className="chapter-player-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSplitChapterId(undefined); }}>
      <DialogSurface className="chapter-split-modal" aria-labelledby="chapter-split-title" onDismiss={busy ? undefined : () => setSplitChapterId(undefined)}>
        <button type="button" className="chapter-player-close" aria-label={t("Close chapter split")} disabled={busy} onClick={() => setSplitChapterId(undefined)}>×</button>
        <div className="chapter-split-heading"><span aria-hidden="true">↯</span><div><span className="eyebrow">{t("Long chapter")}</span><h2 id="chapter-split-title">{t("Split this into shorter chapters?")}</h2></div></div>
        <p>{t("{{title}} has {{duration}} of audio. It will become approximately {{count}} ordinary chapters around 30 minutes each.", { title: splitChapter.title, duration: chapterDuration(splitSeconds), count: proposedPartCount })}</p>
        <div className="chapter-split-facts"><span><b>{t("≈ {{count}} chapters", { count: proposedPartCount })}</b><small>{t("Usually 25–35 min each")}</small></span><span><b>{t("Safe text breaks")}</b><small>{t("Never inside a speech section")}</small></span></div>
        <p className="chapter-split-note">{t("The original item will be replaced. Review, cast and voices stay unchanged.")}</p>
        <div className="chapter-split-actions"><button className="ghost" type="button" disabled={busy} onClick={() => setSplitChapterId(undefined)}>{t("Cancel")}</button><button className="primary" type="button" disabled={busy} onClick={() => void splitLongChapter(splitChapter.id)}>{busy ? t("Splitting…") : t("Split into ≈ {{count}} chapters", { count: proposedPartCount })}</button></div>
      </DialogSurface>
    </div>}

    {listeningChapter && listeningAudio && <div className="chapter-player-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setListeningChapterId(undefined); }}>
      <DialogSurface className="chapter-player-modal" aria-labelledby="chapter-player-title" onDismiss={() => setListeningChapterId(undefined)}>
        <button type="button" className="chapter-player-close" aria-label={t("Close player")} onClick={() => setListeningChapterId(undefined)}>×</button>
        <div className="chapter-player-book" aria-hidden="true"><span>{t("Chapter")}</span><b>{String(chapters.findIndex((chapter) => chapter.id === listeningChapter.id) + 1).padStart(2, "0")}</b><i>♪</i></div>
        <div className="chapter-player-copy"><span className="eyebrow">{t(listeningAudio.current ? "Chapter audio" : "Older recording")}</span><h2 id="chapter-player-title">{listeningChapter.title || t("Untitled chapter")}</h2></div>
        <ChapterAudioPlayer src={listeningAudio.audioUrl} />
      </DialogSurface>
    </div>}
  </>;

}
