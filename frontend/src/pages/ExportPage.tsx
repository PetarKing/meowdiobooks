import type {
  AudioExportPreset
} from "../api/contracts";
import { sourcePageImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { WorkflowEmpty } from "../components/WorkflowPage";
import { useFloatingActionDock } from "../components/useFloatingActionDock";
import { PdfCoverPageInput, StepEyebrow } from "../pages/shared";
import {
  chapterDuration
} from "../workflow/generation";
import {
  DEFAULT_EXPORT_DESCRIPTION,
  estimatedAudioExportBytes,
  formatFileSize
} from "../workflow/presentation";

export type ExportPageModel = Pick<WorkflowModel, "gateway" | "book" | "exportAuthor" | "exportChapterIds" | "exportCover" | "exportCoverPage" | "exportCoverPreviewUrl" | "exportDescription" | "exportCurrent" | "exportPreset" | "exportTitle" | "exporting" | "setExportAuthor" | "setExportChapterIds" | "setExportCover" | "setExportCoverPage" | "setExportDescription" | "setExportPreset" | "setExportTitle" | "setStage" | "snapshot" | "stageIndex" | "t">;

export function ExportPage({ model }: { model: ExportPageModel; }) {
  const { gateway, book, exportAuthor, exportChapterIds, exportCover, exportCoverPage, exportCoverPreviewUrl, exportDescription, exportCurrent, exportPreset, exportTitle, exporting, setExportAuthor, setExportChapterIds, setExportCover, setExportCoverPage, setExportDescription, setExportPreset, setExportTitle, setStage, snapshot, stageIndex, t } = model;
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
  const compactExportAction = exportPreset === "mp3-chapters" ? t("Create ZIP") : t("Create M4B");
  const exportProgress = exportPreset === "mp3-chapters" ? t("Saving MP3 ZIP…") : t("Saving M4B…");
  const exportSummary = exportPreset === "m4b-high" ? t("A chaptered, high-quality M4B with the details shown above.") : exportPreset === "m4b-compact" ? t("A chaptered M4B at half the usual size, with the details shown above.") : t("A ZIP with one ordered, tagged MP3 file per selected chapter.");
  const pdfCoverUrl = book ? sourcePageImageUrl(gateway, book.id, exportCoverPage) : undefined;
  const coverUrl = exportCover ? exportCoverPreviewUrl ?? pdfCoverUrl : pdfCoverUrl;
  const pageCount = book?.pageCount ?? 1;
  return <div className="edition-workbench">
    <section className="edition-intro">
      <StepEyebrow stage="export">{t("Step 6 · Export")}</StepEyebrow>
      <h1>{t("Prepare your audiobook")}</h1>
      <p>{t("Choose finished chapters, check the book details, and pick a format.")}</p>
    </section>

    {!playableChapters.length ? <WorkflowEmpty className="export-empty" symbol="♪" title={t("Generate a chapter first.")} copy={t("Generate current chapter audio before exporting.")}><button className="primary" onClick={() => setStage(stageIndex("generate"))}>← {t("Back to Generate")}</button></WorkflowEmpty> : <>
      <div className="edition-identity">
        <section className="edition-proof" aria-label={t("Audiobook preview")}>
          <div className="edition-cover-stage">
            <div className="edition-cover-frame">
              <div className="edition-cover">{coverUrl && <img src={coverUrl} alt={t("Current audiobook cover")} />}</div>
              <div className="edition-cover-tools">
                <div className="edition-cover-top">
                  <div className="edition-cover-source"><span className="eyebrow">{t("Front page")}</span><span>{exportCover?.name ?? t("PDF page {{page}} of {{count}}", { page: exportCoverPage, count: pageCount })}</span></div>
                  <div className="edition-cover-image-actions">
                    <label className="edition-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setExportCover(event.target.files?.[0])} /><span>{t(exportCover ? "Change image" : "Choose image")}</span></label>
                    {exportCover && <button type="button" className="edition-use-pdf" onClick={() => setExportCover(undefined)}>{t("Use PDF page")}</button>}
                  </div>
                </div>
                {!exportCover && <div className="edition-cover-navigation">
                  {pageCount > 1 && <button type="button" className="edition-cover-step" aria-label={t("Previous cover page")} disabled={exportCoverPage <= 1} onClick={() => setExportCoverPage(exportCoverPage - 1)}>‹</button>}
                  <label className="edition-page-picker">{t("Page")}<PdfCoverPageInput label={t("PDF cover page")} value={exportCoverPage} max={pageCount} onChange={setExportCoverPage} /><span aria-hidden="true">/ {pageCount}</span></label>
                  {pageCount > 1 && <button type="button" className="edition-cover-step" aria-label={t("Next cover page")} disabled={exportCoverPage >= pageCount} onClick={() => setExportCoverPage(exportCoverPage + 1)}>›</button>}
                </div>}
              </div>
            </div>
          </div>
        </section>
        <section className="edition-details" aria-labelledby="edition-details-title">
          <header><div><span className="eyebrow">{t("Book details")}</span><h2 id="edition-details-title" className="visually-hidden">{t("Book details")}</h2></div><button type="button" className="edition-reset" aria-label={t("Reset book details")} title={t("Reset book details")} onClick={() => { setExportTitle(book?.title ?? ""); setExportAuthor(book?.author ?? ""); setExportDescription(t(DEFAULT_EXPORT_DESCRIPTION)); setExportCover(undefined); setExportCoverPage(1); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /></svg></button></header>
          <div className="edition-editable-identity">
            <label className="edition-field edition-title-field"><EditionFieldLabel>{t("Title")}</EditionFieldLabel><textarea aria-label={t("Title")} value={exportTitle} rows={2} maxLength={500} onChange={(event) => setExportTitle(event.target.value)} /></label>
            <label className="edition-field edition-author-field"><EditionFieldLabel>{t("Author")}</EditionFieldLabel><input value={exportAuthor} maxLength={500} onChange={(event) => setExportAuthor(event.target.value)} /></label>
            <label className="edition-field edition-description-field"><EditionFieldLabel>{t("Description")}</EditionFieldLabel><textarea aria-label={t("Description")} value={exportDescription} maxLength={2000} rows={2} onChange={(event) => setExportDescription(event.target.value)} /></label>
          </div>
          <div className="edition-proof-facts"><span>{t("{{count}} chapters · {{duration}}", { count: selectedPlayable.length, duration: chapterDuration(selectedSeconds, false) })}</span><span>{exportChoices.find((choice) => choice.preset === exportPreset)?.title}</span></div>
        </section>
      </div>

      <div className="edition-output">
      <div className="edition-selections">
      <section className="edition-contents" aria-labelledby="edition-contents-title">
        <header><div><span className="eyebrow">{t("Choose audio")}</span><h2 id="edition-contents-title">{t("Chapters to include")}</h2></div><div className="edition-bulk"><span className="edition-selected-count" aria-live="polite">{t("{{count}} chapters selected", { count: selectedPlayable.length })}</span><button type="button" onClick={() => setExportChapterIds(playableChapters.map((row) => row.id))}>{t("Select all")}</button><button type="button" onClick={() => setExportChapterIds([])}>{t("Clear")}</button></div></header>
        <div className="edition-chapters">{playableChapters.map((row) => {
          const index = (snapshot?.chapters ?? []).findIndex((chapter) => chapter.id === row.id);
          const audio = generatedByChapter.get(row.id)!;
          const selected = exportChapterIds.includes(row.id);
          const chapterNumber = String(index + 1).padStart(2, "0");
          const duration = chapterDuration(audio.audioSeconds, false);
          return <label key={row.id} className={selected ? "selected" : ""}>
            <input aria-describedby={`export-chapter-${row.id}-title`} aria-label={t("Chapter {{number}}, {{duration}}", { number: chapterNumber, duration })} type="checkbox" checked={selected} onChange={(event) => setExportChapterIds(event.target.checked ? [...new Set([...exportChapterIds, row.id])] : exportChapterIds.filter((id) => id !== row.id))} />
            <span className="edition-chapter-number" aria-hidden="true">{chapterNumber}</span>
            <b id={`export-chapter-${row.id}-title`}>{row.title || t("Chapter {{number}}", { number: index + 1 })}</b>
            <span className="edition-chapter-duration">{duration}</span>
          </label>;
        })}</div>
        {playableChapters.length > 7 && <p className="edition-scroll-hint">↓ {t("Scroll to browse")}</p>}
      </section>

      <section className="edition-format" aria-labelledby="export-format-title">
        <header><span className="eyebrow">{t("Output format")}</span><h2 id="export-format-title">{t("Choose your file")}</h2></header>
        <div className="edition-format-options" role="radiogroup" aria-label={t("Output format")}>
          {exportChoices.map((choice) => {
            const selected = exportPreset === choice.preset;
            const estimate = selectedSeconds ? formatFileSize(estimatedAudioExportBytes(selectedSeconds, choice.preset)) : "—";
            return <label key={choice.preset} className={selected ? "selected" : ""}>
              <div className="edition-format-top"><input type="radio" name="audio-export-preset" value={choice.preset} checked={selected} onChange={() => setExportPreset(choice.preset)} /><b>{choice.title}</b></div>
              <small>{choice.technical}</small><p>{choice.description}</p>
              <strong aria-label={t("Approximately {{size}}", { size: estimate })}>≈ {estimate}</strong>
            </label>;
          })}
        </div>
      </section>
      </div>

      <ExportRelease
        ariaLabel={t("Export summary")}
        eyebrow={t("Ready to create")}
        title={selectedPlayable.length ? t("{{count}} chapters · {{duration}}", { count: selectedPlayable.length, duration: chapterDuration(selectedSeconds, false) }) : t("Choose at least one chapter")}
        summary={exportSummary}
        action={exportAction}
        compactAction={compactExportAction}
        progress={exportProgress}
        exporting={exporting}
        disabled={exporting || !selectedPlayable.length || !exportTitle.trim()}
        onCreate={() => void exportCurrent()}
      />
      </div>
    </>}
  </div>;
}

function EditionFieldLabel({ children }: { children: string }) {
  return <span className="edition-field-label">{children}<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" /></svg></span>;
}

function ExportRelease({ ariaLabel, eyebrow, title, summary, action, compactAction, progress, exporting, disabled, onCreate }: {
  ariaLabel: string; eyebrow: string; title: string; summary: string; action: string; compactAction: string; progress: string;
  exporting: boolean; disabled: boolean; onCreate: () => void;
}) {
  const { anchorRef, floating } = useFloatingActionDock();

  return <>
    <span ref={anchorRef} className="edition-release-anchor" aria-hidden="true" />
    <section className={`edition-release${floating ? " is-floating" : ""}`} aria-label={ariaLabel}>
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{summary}</p></div>
      <button className="primary" aria-label={exporting ? progress : `${action} →`} disabled={disabled} onClick={onCreate}>
        <span className="edition-action-full">{exporting ? progress : `${action} →`}</span>
        <span className="edition-action-compact" aria-hidden="true">{exporting ? progress : `${compactAction} →`}</span>
      </button>
    </section>
  </>;
}
