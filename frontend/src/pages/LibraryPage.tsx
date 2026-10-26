import { useState } from "react";
import { ReadingCatCompanion } from "../components/ReadingCatCompanion";
import { libraryCoverImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import {
  formatFileSize,
  formatLibraryChapters,
  formatLibraryDate,
  formatLibraryExport,
  localizeErrorMessage
} from "../workflow/presentation";
import { LibrarySkeleton } from "./LibrarySkeleton";

export type LibraryPageModel = Pick<WorkflowModel, "gateway" | "libraryError" | "libraryExports" | "libraryLoading" | "libraryReady" | "navigateProduct" | "openLibraryItem" | "refreshLibrary" | "renderLibraryActions" | "revealLibraryItem" | "t" | "uiLocale">;

function LibraryCover({ src, alt }: { src: string; alt: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return <div className="library-cover" data-unavailable={unavailable || undefined}>
    <svg className="library-cover-fallback" viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="31" /><path d="M24 46V36a16 16 0 0 1 32 0v10M24 38h5v15h-5zM51 38h5v15h-5zM36 36v16M40 31v26M44 37v14" /></svg>
    {!unavailable && <img src={src} alt={alt} loading="lazy" onError={() => setUnavailable(true)} />}
  </div>;
}

export function LibraryPage({ model }: { model: LibraryPageModel; }) {
  const { gateway, libraryError, libraryExports, libraryLoading, libraryReady, navigateProduct, openLibraryItem, refreshLibrary, renderLibraryActions, revealLibraryItem, t, uiLocale } = model;
  const loadingFirstEditions = !libraryReady || (libraryLoading && !libraryExports.length);
  const empty = !loadingFirstEditions && !libraryExports.length && !libraryError;
  return <section className={`library-page${empty ? " library-page--empty" : ""}`} aria-busy={libraryLoading}>
    {!empty && <header className="library-head">
      {libraryExports.length > 0 && <ReadingCatCompanion variant="library" />}
      <div className="library-head-copy"><h1>{t("Your audiobooks")}</h1><p>{t("library.storageDescription", { ns: "edition" })}</p></div>

      {(loadingFirstEditions || libraryExports.length > 0) && <span className="library-count" aria-live="polite">{libraryLoading ? t("Loading…") : libraryExports.length === 1 ? t("1 audiobook") : t("{{count}} audiobooks", { count: libraryExports.length })}</span>}
    </header>}
    {libraryError && <div className={`library-load-error ${libraryExports.length ? "has-editions" : ""}`} role="alert"><span className="library-error-symbol" aria-hidden="true">↻</span><p>{localizeErrorMessage(libraryError, t)}</p><button className="ghost" disabled={libraryLoading} onClick={() => void refreshLibrary()}>{t("Try again")} <span aria-hidden="true">↗</span></button></div>}
    {loadingFirstEditions ? <LibrarySkeleton model={{ t }} /> : libraryExports.length ? <div className="library-grid">{libraryExports.map((item) => <article key={item.id} className="library-book">
      <LibraryCover key={libraryCoverImageUrl(gateway, item.id)} src={libraryCoverImageUrl(gateway, item.id)} alt={t("Cover of {{title}}", { title: item.title })} />
      <div className="library-book-body">
        <div className="library-book-copy"><span className="library-format">{formatLibraryExport(item, t)}</span><h2>{item.title}</h2><p>{item.author}</p><div className="library-chapters"><b>{formatLibraryChapters(item, t)}</b></div><div className="library-meta"><span>{formatFileSize(item.sizeBytes)}</span><span>{formatLibraryDate(item.createdAt, uiLocale)}</span></div></div>
        <div className="library-actions">{renderLibraryActions ? renderLibraryActions(item) : <><button className="primary library-open-action" onClick={() => void openLibraryItem(item.id)}><span className="library-action-symbol" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M7 4.5 15 10l-8 5.5z" fill="currentColor" /></svg></span>{t("library.openAction", { ns: "edition" })}</button><button className="ghost library-reveal-action" onClick={() => void revealLibraryItem(item.id)}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 6.5V4.5h5l2 2h8v9h-15z" /><path d="M2.5 6.5h15" /></svg>{t("library.revealAction", { ns: "edition" })}</button></>}</div>
      </div>
    </article>)}</div> : !libraryError && <div className="library-empty-composition"><div className="library-empty-copy"><span className="studio-kicker">{t("Your audiobooks")}</span><h1>{t("No audiobooks yet.")}</h1><p>{t("Create an audiobook in Export and it will appear here automatically.")}</p><button className="primary" onClick={() => navigateProduct("create")}>{t("Back to creating")} →</button></div><ReadingCatCompanion variant="empty" /></div>}
  </section>;

}
