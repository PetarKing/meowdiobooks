import type { WorkflowModel } from "../app/useWorkflowModel";
import { StudioHero } from "../components/StudioHero";
import { Panel } from "../components/Ui";
import { formatFileSize } from "../workflow/presentation";

export type HomePageModel = Pick<WorkflowModel, "books" | "booksError" | "booksLoading" | "refreshBooks" | "busy" | "deletingBookId" | "file" | "importBook" | "navigateProduct" | "openBook" | "openingBookId" | "setBookPendingDeletion" | "setFile" | "t">;

export function HomePage({ model }: { model: HomePageModel; }) {
  const { books, booksError, booksLoading, refreshBooks, busy, deletingBookId, file, importBook, navigateProduct, openBook, openingBookId, setBookPendingDeletion, setFile, t } = model;
  const totalAssetBytes = books.reduce((total, row) => total + (row.asset_size_bytes ?? 0), 0);

  return <>
    <StudioHero compact={books.length > 0} eyebrow={t("Your audiobook studio")} title={<>{t("From page")}<br /><em>{t("to performance.")}</em></>} description={t("Turn a book into an audiobook, with control at every step.")}>
      <section className={`quick-import ${file ? "has-file" : ""}`} aria-labelledby="quick-import-title">
        <h2 id="quick-import-title" className="visually-hidden">{t(file ? "Ready to begin" : "Start another book")}</h2>
        {file ? <div className="quick-import-ready">
          <div className="file-receipt">
            <span className="import-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5M8 13h8M8 17h5" /></svg><small>{file.name.split(".").pop()?.toUpperCase()}</small></span>
            <span className="import-file-details"><strong title={file.name}>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
            <label className="import-file-replace" title={t("Choose another")}>
              <input className="visually-hidden" type="file" accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown" aria-label={t("Choose another file")} disabled={busy} onChange={(event) => { const replacement = event.target.files?.[0]; if (replacement) setFile(replacement); }} />
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h14m-4-4 4 4-4 4M19 16H5m4-4-4 4 4 4" /></svg>
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={() => void importBook()}>{t("Import book")} →</button>
        </div> : <label className="quick-upload">
          <input type="file" accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown" onChange={(event) => setFile(event.target.files?.[0])} />
          <span className="quick-upload-icon" aria-hidden="true">＋</span>
          <span><strong>{t("Choose book")}</strong><small>{t("PDF, EPUB, TXT, Markdown")}</small></span>
          <span className="upload-arrow" aria-hidden="true">↗</span>
        </label>}
        {file && <p className="import-storage-note">{t("books.importStorageNotice", { ns: "edition" })}</p>}
      </section>
      <button type="button" className="home-mobile-library" onClick={() => navigateProduct("library")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h5v14H4zM10 5h5v14h-5zM17 5l3-.6 2.5 13.6-3 .6z" /></svg>{t("Library")}<span aria-hidden="true">↗</span></button>
    </StudioHero>
    <div className="home-flow">
      {booksLoading && <p role="status">{t("Loading books…")}</p>}
      {booksError && <div className="library-load-error" role="alert">
        <span className="library-error-symbol" aria-hidden="true">↻</span>
        <p>{t("Your books could not be loaded. Try again.")}</p>
        <button className="ghost" disabled={booksLoading} onClick={() => void refreshBooks()}>{t("Try again")}</button>
      </div>}
      {books.length > 0 && <section className="wip-shelf">
        <Panel title={t("books.workingTitle", { ns: "edition" })} actions={<div className="local-assets-summary">
          <b>{books.length === 1 ? t("1 book") : t("{{count}} books", { count: books.length })}</b>
          <span>{t("{{size}} used", { size: formatFileSize(totalAssetBytes) })}</span>
        </div>}>
          <div className="recent-books">{books.map((row) => {
            const opening = openingBookId === row.id;
            return <article key={row.id}>
              <button className="recent-book-open" disabled={Boolean(openingBookId) || Boolean(deletingBookId)} aria-busy={opening} onClick={() => void openBook(row)}>
                <span className="recent-book-details">
                  <strong>{row.title}</strong>
                  <small>{t("{{count}} pages · {{size}}", { count: row.page_count ?? "?", size: formatFileSize(row.asset_size_bytes ?? 0) })}</small>
                </span>
                <b className={opening ? "book-loading" : undefined}>{opening && <i aria-hidden="true" />} {t(opening ? "Opening…" : "Continue")} {!opening && <span className="recent-book-arrow" aria-hidden="true">↗</span>}</b>
              </button>
              <button className="recent-book-delete" aria-label={t("Delete {{title}}", { title: row.title })} title={t("Delete")} disabled={Boolean(openingBookId) || Boolean(deletingBookId)} onClick={() => setBookPendingDeletion(row)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button>
            </article>;
          })}</div>
        </Panel>
      </section>}
    </div>
  </>;
}
