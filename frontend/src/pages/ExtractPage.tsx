import type {
  ExtractionMethod
} from "../api/contracts";
import { sourcePageImageUrl } from "../app/mediaUrls";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { Choice, Panel } from "../components/Ui";
import { AcceptedSummary, PageComparison, ReviewPreviewSkeleton, StepEyebrow } from "../pages/shared";
import { methodLabel } from "./helpers";

export type ExtractPageModel = Pick<WorkflowModel, "book" | "gateway" | "busy" | "completed" | "extractionCandidate" | "error" | "returnLocation" | "extractionPreview" | "extractionPreviewPage" | "extractionPreviewLoading" | "extractionPreviewFailed" | "method" | "previewPage" | "processAndPublishExtraction" | "representatives" | "revisingStages" | "setMethod" | "setRevisingStages" | "snapshot" | "t">;

export function ExtractPage({ model }: { model: ExtractPageModel; }) {
  const { book, gateway, busy, completed, extractionCandidate, error, returnLocation, extractionPreview, extractionPreviewPage, extractionPreviewLoading, extractionPreviewFailed, method, previewPage, processAndPublishExtraction, representatives, revisingStages, setMethod, setRevisingStages, snapshot, t } = model;
  const page = extractionPreviewPage;
  if (extractionCandidate) return <><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow>{error ? !returnLocation && <button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t("Retry")}</button> : <p role="status">{t("Saving extracted text")}</p>}</>;
  if (completed.includes("extract") && !revisingStages.includes("extract")) return <AcceptedSummary stage="extract" step={t("Step 1")} title={t("Extraction complete")} revision={snapshot?.activeArtifacts.extraction} onRevise={() => setRevisingStages([...new Set([...revisingStages, "extract"])])}><span><b>{book?.pageCount ?? "—"}</b><small>{t("Pages extracted")}</small></span><span><b>{t(methodLabel(method))}</b><small>{t("Reading method")}</small></span></AcceptedSummary>;
  return <><section className="extract-hero">
    <div className="extract-hero-copy"><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow><h1>{t("Check the extracted text")}</h1><p>{t("Compare the sample pages, choose how to read the text, then process the full book.")}</p></div>

  </section>
    {completed.includes("extract") && <p className="panel-copy">{t("Your accepted text stays in use until a new extraction succeeds.")}</p>}
    <div className="choice-row extraction-choices">{(["liteparse", "ocr", "native", "layout"] as ExtractionMethod[]).map((id) => {
      const title = t(methodLabel(id));
      const specialized = id === "native" || id === "layout";
      return <Choice key={id} selected={method === id} onClick={() => { setMethod(id); void previewPage(page, id); }} title={title} badge={id === "liteparse" ? t("Recommended") : specialized ? t("Specialized") : undefined} badgeTone={specialized ? "muted" : undefined} text={t(id === "ocr" ? "Reads each page as an image. Slower." : id === "liteparse" ? "Fast extraction with OCR recovery." : id === "native" ? "Reads text saved in the PDF" : "For columns and unusual spacing")} />;
    })}</div>
    <div className="sample-reasons">{representatives.map((row) => <button key={row.page} aria-pressed={row.page === page} className={row.page === page ? "selected" : ""} onClick={() => void previewPage(row.page)}><b>{t("p. {{page}}", { page: row.page })}</b><span>{t(row.reason, { defaultValue: row.reason })}</span></button>)}</div>
    <Panel variant="plain" title={t("Page {{page}} of {{count}}", { page, count: extractionPreview?.pageCount ?? book?.pageCount ?? "?" })}>
      {extractionPreviewLoading && <p className="visually-hidden" role="status">{t("Loading page {{page}}…", { page })}</p>}
      <div aria-busy={extractionPreviewLoading} className="extraction-preview-stage">
        <PageComparison className="extract-page-comparison" sourcePlaceholder={<ReviewPreviewSkeleton source />} imageUrl={extractionPreview?.imageUrl ?? (book ? sourcePageImageUrl(gateway, book.id, page) : undefined)} imageAlt={t("Original page {{page}}", { page })} rightLabel={t("Extracted text")}>
          {extractionPreviewFailed ? <div className="review-preview-unavailable" role="status"><p>{t("This page preview could not load.")}</p><button type="button" className="ghost" onClick={() => void previewPage(page)}>{t("Retry page preview")}</button></div> : !extractionPreview ? <ReviewPreviewSkeleton source /> : <pre>{extractionPreview.text}</pre>}
        </PageComparison>
      </div>
    </Panel>
    <div className="phase-action extract-final-action"><button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t("Process complete book")} →</button></div>
  </>;

}
