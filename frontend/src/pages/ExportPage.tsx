import type {
  AudioExportPreset
} from "../api/contracts";
import { sourcePageImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { PdfCoverPageInput, StepEyebrow } from "../pages/shared";
import {
  chapterDuration
} from "../workflow/generation";
import {
  estimatedAudioExportBytes,
  formatFileSize
} from "../workflow/presentation";

export type ExportPageModel = Pick<WorkflowModel, "gateway" | "book" | "exportAuthor" | "exportChapterIds" | "exportCover" | "exportCoverPage" | "exportCoverPreviewUrl" | "exportCurrent" | "exportPreset" | "exportTitle" | "exporting" | "setExportAuthor" | "setExportChapterIds" | "setExportCover" | "setExportCoverPage" | "setExportPreset" | "setExportTitle" | "setStage" | "snapshot" | "stageIndex" | "t">;

export function ExportPage({ model }: { model: ExportPageModel; }) {
  const { gateway, book, exportAuthor, exportChapterIds, exportCover, exportCoverPage, exportCoverPreviewUrl, exportCurrent, exportPreset, exportTitle, exporting, setExportAuthor, setExportChapterIds, setExportCover, setExportCoverPage, setExportPreset, setExportTitle, setStage, snapshot, stageIndex, t } = model;
  const generatedByChapter = new Map((snapshot?.generatedChapters ?? []).filter((row) => row.current).map((row) => [row.chapterId, row]));
  const playableChapters = (snapshot?.chapters ?? []).filter((row) => generatedByChapter.has(row.id));
  const selectedPlayable = playableChapters.filter((row) => exportChapterIds.includes(row.id));
  const selectedSeconds = selectedPlayable.reduce((total, row) => total + (generatedByChapter.get(row.id)?.audioSeconds ?? 0), 0);
  const exportChoices: Array<{ preset: AudioExportPreset; title: string; technical: string; description: string; }> = [
    { preset: "m4b-high", title: t("High-quality M4B"), technical: t("128 kbps AAC · Chapters and cover"), description: t("Best listening quality. Recommended.") },
    { preset: "m4b-compact", title: t("Smaller M4B"), technical: t("64 kbps AAC · Chapters and cover"), description: t("Half the size, still optimized for spoken audio.") },
    { preset: "mp3-chapters", title: t("MP3 chapters"), technical: t("96 kbps MP3 · ZIP download"), description: t("One widely compatible MP3 per chapter.") },
  ];
  const exportAction = exportPreset === "m4b-high" ? t("Create high-quality M4B") : exportPreset === "m4b-compact" ? t("Create smaller M4B") : t("Create MP3 ZIP");
  const exportProgress = exportPreset === "mp3-chapters" ? t("Saving MP3 ZIP…") : t("Saving M4B…");
  const exportSummary = exportPreset === "m4b-high" ? t("A chaptered, high-quality M4B with the details shown above.") : exportPreset === "m4b-compact" ? t("A chaptered M4B at half the usual size, with the details shown above.") : t("A ZIP with one ordered, tagged MP3 file per selected chapter.");
  const pdfCoverUrl = book ? sourcePageImageUrl(gateway, book.id, exportCoverPage) : undefined;
  const coverUrl = exportCoverPreviewUrl ?? pdfCoverUrl;
  const pageCount = book?.pageCount ?? 1;
  return <>
    <section className="export-hero">

      <div><StepEyebrow stage="export">{t("Step 6 · Export")}</StepEyebrow><h1>{t("Prepare your audiobook")}</h1><p>{t("Choose finished chapters, check the book details, and pick a format.")}</p></div>
    </section>

    {!playableChapters.length ? <WorkflowEmpty className="export-empty" symbol="♪" title={t("Generate a chapter first.")} copy={t("Generate current chapter audio before exporting.")}><button className="primary" onClick={() => setStage(stageIndex("generate"))}>← {t("Back to Generate")}</button></WorkflowEmpty> : <>
      <section className="export-layout">
        <div className="export-editor">
        <div className="export-chapter-picker">
          <header><div><span className="eyebrow">{t("Choose audio")}</span><h2>{t("Chapters to include")}</h2></div><div className="chapter-bulk-actions"><button type="button" onClick={() => setExportChapterIds(playableChapters.map((row) => row.id))}>{t("Select all")}</button><button type="button" onClick={() => setExportChapterIds([])}>{t("Clear")}</button></div></header>
          <div className="export-chapter-list">{playableChapters.map((row) => {
            const index = (snapshot?.chapters ?? []).findIndex((chapter) => chapter.id === row.id);
            const audio = generatedByChapter.get(row.id)!;
            const selected = exportChapterIds.includes(row.id);
            const chapterNumber = String(index + 1).padStart(2, "0");
            const duration = chapterDuration(audio.audioSeconds, false);
            return <label key={row.id} className={selected ? "selected" : ""}>
              <input aria-describedby={`export-chapter-${row.id}-title`} aria-label={t("Chapter {{number}}, {{duration}}", { number: chapterNumber, duration })} type="checkbox" checked={selected} onChange={(event) => setExportChapterIds(event.target.checked ? [...new Set([...exportChapterIds, row.id])] : exportChapterIds.filter((id) => id !== row.id))} />
              <span className="export-chapter-number" aria-hidden="true">{chapterNumber}</span>
              <span className="export-chapter-copy"><b id={`export-chapter-${row.id}-title`}>{row.title || t("Chapter {{number}}", { number: index + 1 })}</b><span className="export-chapter-duration">{duration}</span></span>
              <i aria-hidden="true">{selected ? "✓" : "+"}</i>
            </label>;
          })}</div>
        </div>

          <div className="export-metadata">
            <header><span className="eyebrow">{t("Book details")}</span><h2>{t("How it appears in your library")}</h2></header>
            <div className="export-cover-preview">
              {coverUrl && <img src={coverUrl} alt={t("Current audiobook cover")} />}
              <span><b>{t("Cover")}</b><small>{exportCover?.name ?? t("Page {{page}}", { page: exportCoverPage })}</small></span>
              <div className="export-cover-actions">
                {!exportCover && <label className="export-cover-page">{t("PDF page")}<PdfCoverPageInput label={t("PDF cover page")} value={exportCoverPage} max={pageCount} onChange={setExportCoverPage} /></label>}
                <label className="export-cover-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setExportCover(event.target.files?.[0])} /><span>{t(exportCover ? "Change image" : "Choose image")}</span></label>
                {exportCover && <button type="button" className="text-button" onClick={() => setExportCover(undefined)}>{t("Use PDF page")}</button>}
              </div>
            </div>
            <label>{t("Title")}<input value={exportTitle} maxLength={500} onChange={(event) => setExportTitle(event.target.value)} /></label>
            <label>{t("Author")}<input value={exportAuthor} maxLength={500} onChange={(event) => setExportAuthor(event.target.value)} /></label>
            <button type="button" className="text-button export-reset" onClick={() => { setExportTitle(book?.title ?? ""); setExportAuthor(book?.author ?? ""); setExportCover(undefined); setExportCoverPage(1); }}>{t("Reset book details")}</button>
          </div>
        </div>

        <div className="export-sidebar">
          <section className="export-preview" aria-label={t("Audiobook preview")}><div className="export-preview-cover">{coverUrl && <img src={coverUrl} alt={t("Audiobook preview cover")} />}</div><div><span className="eyebrow">{t("Audiobook preview")}</span><h2>{exportTitle || book?.title}</h2><p>{exportAuthor || book?.author}</p><small>{t("{{count}} chapters · {{duration}}", { count: selectedPlayable.length, duration: chapterDuration(selectedSeconds, false) })}</small><span className="export-preview-format">{exportChoices.find((choice) => choice.preset === exportPreset)?.title}</span></div></section>
          <section className="export-format" aria-labelledby="export-format-title">
            <header><span className="eyebrow">{t("Output format")}</span><h2 id="export-format-title">{t("Choose your file")}</h2></header>
            <div className="export-format-options" role="radiogroup" aria-label={t("Output format")}>
              {exportChoices.map((choice) => {
                const selected = exportPreset === choice.preset;
                const estimate = selectedSeconds ? formatFileSize(estimatedAudioExportBytes(selectedSeconds, choice.preset)) : "—";
                return <label key={choice.preset} className={selected ? "selected" : ""}>
                  <input type="radio" name="audio-export-preset" value={choice.preset} checked={selected} onChange={() => setExportPreset(choice.preset)} />
                  <span className="export-format-copy"><b>{choice.title}</b><small>{choice.technical}</small><em>{choice.description}</em></span>
                  <strong aria-label={t("Approximately {{size}}", { size: estimate })}>≈ {estimate}</strong>
                </label>;
              })}
            </div>
          </section>
        </div>
      </section>

      <section className="export-summary" aria-label={t("Export summary")}>
        <div><span className="eyebrow">{t("Ready to create")}</span><h2>{selectedPlayable.length ? t("{{count}} chapters · {{duration}}", { count: selectedPlayable.length, duration: chapterDuration(selectedSeconds, false) }) : t("Choose at least one chapter")}</h2><p>{exportSummary}</p></div>
        <button className="primary" disabled={exporting || !selectedPlayable.length || !exportTitle.trim()} onClick={() => void exportCurrent()}>{exporting ? exportProgress : `${exportAction} →`}</button>
      </section>
    </>}
  </>;

}
