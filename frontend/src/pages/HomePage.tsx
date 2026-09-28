import type { WorkflowModel } from "../app/useWorkflowModel";
import { StudioHero } from "../components/StudioHero";
import { Panel } from "../components/Ui";
import {
  formatFileSize,
  monogram
} from "../workflow/presentation";

export type HomePageModel = Pick<WorkflowModel, "books" | "busy" | "deletingBookId" | "file" | "importBook" | "openBook" | "openingBookId" | "setBookPendingDeletion" | "setFile" | "t">;

export function HomePage({ model }: { model: HomePageModel; }) {
  const { books, busy, deletingBookId, file, importBook, openBook, openingBookId, setBookPendingDeletion, setFile, t } = model;
  const localBooks = books.filter((row) => row.source_name);
  const totalAssetBytes = localBooks.reduce((total, row) => total + (row.asset_size_bytes ?? 0), 0);
  return <>
    <StudioHero eyebrow={t("Your audiobook studio")} title={<>{t("From page")}<br /><em>{t("to performance.")}</em></>} description={t("Turn a PDF into an audiobook, with control at every step.")}>
      <section className={`quick-import ${file ? "has-file" : ""}`} aria-labelledby="quick-import-title">
        <h2 id="quick-import-title" className="visually-hidden">{t(file ? "Ready to begin" : "Start another book")}</h2>
        {file ? <div className="quick-import-ready"><div className="file-receipt"><span className="recent-cover">PDF</span><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button className="text-button" onClick={() => setFile(undefined)}>{t("Choose another")}</button></div><button className="primary" disabled={busy} onClick={() => void importBook()}>{t("Import PDF")} →</button></div> : <label className="quick-upload"><input type="file" accept=".pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0])} /><span className="quick-upload-icon" aria-hidden="true">＋</span><span><strong>{t("Choose PDF")}</strong><small>{t("PDF · up to 500 MB")}</small></span><span className="upload-arrow" aria-hidden="true">↗</span></label>}
        {file && <p className="import-storage-note">{t("books.importStorageNotice", { ns: "edition" })}</p>}
      </section>
    </StudioHero>
    <div className="home-flow">
      {localBooks.length > 0 && <section className="wip-shelf"><Panel eyebrow={t("Work in progress")} title={t("books.workingTitle", { ns: "edition" })} actions={<div className="local-assets-summary"><b>{localBooks.length === 1 ? t("1 book") : t("{{count}} books", { count: localBooks.length })}</b><span>{t("{{size}} used", { size: formatFileSize(totalAssetBytes) })}</span></div>}><div className="recent-books">{localBooks.map((row) => { const opening = openingBookId === row.id; return <article key={row.id}><button className="recent-book-open" disabled={Boolean(openingBookId) || Boolean(deletingBookId)} aria-busy={opening} onClick={() => void openBook(row)}><span className="recent-cover">{monogram(row.title)}</span><span className="recent-book-details"><strong>{row.title}</strong><small>{t("{{count}} pages · {{size}}", { count: row.page_count ?? "?", size: formatFileSize(row.asset_size_bytes ?? 0) })}</small></span><b className={opening ? "book-loading" : undefined}>{opening && <i aria-hidden="true" />} {t(opening ? "Opening…" : "Continue")} {!opening && "↗"}</b></button><button className="recent-book-delete" aria-label={t("Delete {{title}}", { title: row.title })} disabled={Boolean(openingBookId) || Boolean(deletingBookId)} onClick={() => setBookPendingDeletion(row)}>{t("Delete")}</button></article>; })}</div></Panel></section>}
    </div>

  </>;

}
