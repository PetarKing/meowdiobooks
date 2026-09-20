import { libraryCoverImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import brandMark from "../assets/brand/meowdiobooks-mark.png";
import {
  formatFileSize,
  formatLibraryChapters,
  formatLibraryDate,
  formatLibraryExport,
  monogram
} from "../workflow/presentation";
import { LibrarySkeleton } from "./LibrarySkeleton";

export type LibraryPageModel = Pick<WorkflowModel, "gateway" | "libraryExports" | "libraryReady" | "navigateProduct" | "openLibraryItem" | "renderLibraryActions" | "revealLibraryItem" | "t" | "uiLocale">;

export function LibraryPage({ model }: { model: LibraryPageModel; }) {
  const { gateway, libraryExports, libraryReady, navigateProduct, openLibraryItem, renderLibraryActions, revealLibraryItem, t, uiLocale } = model;
  return <section className="library-page">
    <header className="library-head">
      <div className="library-head-copy"><span className="eyebrow">{t("The story made it")}</span><h1>{t("Your audiobooks")}</h1><p>{t("library.storageDescription", { ns: "edition" })}</p></div>
      <div className="library-finale" aria-hidden="true"><span className="library-finale-disc">♪</span><span className="library-finale-mark"><img src={brandMark} alt="" /></span></div>
      <span className="library-count">{!libraryReady ? t("Loading…") : libraryExports.length === 1 ? t("1 audiobook") : t("{{count}} audiobooks", { count: libraryExports.length })}</span>
    </header>
    {!libraryReady ? <LibrarySkeleton model={{ t }} /> : libraryExports.length ? <div className="library-grid">{libraryExports.map((item) => <article key={item.id} className="library-book">
      <div className="library-cover"><span>{monogram(item.title)}</span><img src={libraryCoverImageUrl(gateway, item.id)} alt={t("Cover of {{title}}", { title: item.title })} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /></div>
      <div className="library-book-copy"><span className="library-format">{formatLibraryExport(item, t)}</span><h2>{item.title}</h2><p>{item.author}</p><div className="library-chapters"><b>{formatLibraryChapters(item, t)}</b></div><div className="library-meta"><span>{formatFileSize(item.sizeBytes)}</span><span>{formatLibraryDate(item.createdAt, uiLocale)}</span></div></div>
      <div className="library-actions">{renderLibraryActions ? renderLibraryActions(item) : <><button className="primary" onClick={() => void openLibraryItem(item.id)}>{t("library.openAction", { ns: "edition" })}</button><button className="ghost" onClick={() => void revealLibraryItem(item.id)}>{t("library.revealAction", { ns: "edition" })}</button></>}</div>
    </article>)}</div> : <div className="library-empty"><span aria-hidden="true">♪</span><h2>{t("No audiobooks yet.")}</h2><p>{t("Create an audiobook in Export and it will appear here automatically.")}</p><button className="primary" onClick={() => navigateProduct("create")}>{t("Back to creating")} →</button></div>}
  </section>;

}
