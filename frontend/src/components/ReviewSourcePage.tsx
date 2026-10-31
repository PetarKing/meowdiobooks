import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowGateway } from "../api/contracts";
import { sourcePageImageUrl } from "../app/mediaUrls";
import { DialogBackdrop } from "./DialogBackdrop";
import { DialogSurface } from "./DialogSurface";

/** On-demand original evidence, independent of review choices and transcript acceptance. */
export function ReviewSourcePage({ gateway, bookId, page, pageCount }: {
  gateway: Pick<WorkflowGateway, "sourcePageImageUrl">;
  bookId: string;
  page: number;
  pageCount?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(page);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const changePage = (next: number) => {
    setCurrentPage(next);
    setFailed(false);
    setLoaded(false);
  };
  return <>
    <button type="button" className="ghost review-source-button" onClick={() => { changePage(page); setOpen(true); }}>{t("View original page")}</button>
    {open && <DialogBackdrop onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <DialogSurface className="dialog-card review-source-dialog" aria-label={t("Original PDF page {{page}}", { page: currentPage })} onDismiss={() => setOpen(false)}>
        <div className="review-source-toolbar">
          <b>{t("Page {{page}}", { page: currentPage })}</b>
          <button type="button" className="ghost" onClick={() => setOpen(false)}>{t("Back to review")}</button>
        </div>
        <div className="warning-nav">
          <button type="button" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}>← {t("Previous page")}</button>
          <button type="button" disabled={currentPage >= (pageCount ?? page)} onClick={() => changePage(currentPage + 1)}>{t("Next page")} →</button>
        </div>
        {failed ? <div role="alert"><p>{t("Could not load the original page. Your review choices are unchanged.")}</p><button type="button" className="ghost" onClick={() => { setFailed(false); setLoaded(false); setAttempt(attempt + 1); }}>{t("Try again")}</button></div> : <>
          {!loaded && <p role="status">{t("Loading page {{page}}…", { page: currentPage })}</p>}
          <img key={`${currentPage}:${attempt}`} src={sourcePageImageUrl(gateway, bookId, currentPage)} alt={t("Original PDF page {{page}}", { page: currentPage })} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        </>}
      </DialogSurface>
    </DialogBackdrop>}
  </>;
}
