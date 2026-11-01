import type {
  ExtractionMethod
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import { Choice, Panel } from "../components/Ui";
import { AcceptedSummary, PageComparison, StepEyebrow } from "../pages/shared";
import { methodLabel } from "./helpers";

export type ExtractPageModel = Pick<WorkflowModel, "book" | "busy" | "completed" | "extractionCandidate" | "extractionPreview" | "method" | "previewPage" | "processAndPublishExtraction" | "representatives" | "revisingStages" | "setMethod" | "setRevisingStages" | "snapshot" | "t">;

export function ExtractPage({ model }: { model: ExtractPageModel; }) {
  const { book, busy, completed, extractionCandidate, extractionPreview, method, previewPage, processAndPublishExtraction, representatives, revisingStages, setMethod, setRevisingStages, snapshot, t } = model;
  const page = extractionPreview?.page ?? 1;
  if (extractionCandidate) {
    const recoveryScope = extractionCandidate.recoveredPages ?? extractionCandidate.ocrPages;
    const recoveredPages = Array.isArray(recoveryScope) ? recoveryScope as number[] : [];
    const pages = Array.isArray(extractionCandidate.pages) ? extractionCandidate.pages as Array<{ page: number; text: string }> : [];
    const recovered = pages.find((row) => row.page === (extractionPreview && recoveredPages.includes(extractionPreview.page) ? extractionPreview.page : recoveredPages[0]));
    return <><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow><Panel title={t(recoveredPages.length ? "OCR recovery is ready" : "Full extraction is ready")}>
      <p>{t(recoveredPages.length ? "Compare the recovered text before accepting. Other pages keep their saved text. Dialogue and Review will need rebuilding." : "Use the saved result to continue without extracting again.")}</p>
      {recoveredPages.length > 0 && <>
        <div className="sample-reasons">{recoveredPages.map((number) => <button key={number} onClick={() => void previewPage(number, "native")}>{t("p. {{page}}", { page: number })}</button>)}</div>
        <PageComparison imageUrl={extractionPreview && recoveredPages.includes(extractionPreview.page) ? extractionPreview.imageUrl : undefined} imageAlt={t("Original page {{page}}", { page: recovered?.page ?? recoveredPages[0] })} rightLabel={t("OCR TEXT")}><pre>{recovered?.text}</pre></PageComparison>
      </>}
      <button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t(recoveredPages.length ? "Use recovered text" : "Accept completed extraction")} →</button>
    </Panel></>;
  }
  if (completed.includes("extract") && !revisingStages.includes("extract")) return <AcceptedSummary stage="extract" step={t("Step 1")} title={t("Extraction complete")} revision={snapshot?.activeArtifacts.extraction} onRevise={() => setRevisingStages([...new Set([...revisingStages, "extract"])])}><span><b>{book?.pageCount ?? "—"}</b><small>{t("Pages extracted")}</small></span><span><b>{t(methodLabel(method))}</b><small>{t("Reading method")}</small></span></AcceptedSummary>;
  return <><section className="extract-hero">
    <div className="extract-hero-copy"><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow><h1>{t("Check the extracted text")}</h1><p>{t("Compare the sample pages, choose how to read the text, then process the full book.")}</p></div>

  </section>
    {completed.includes("extract") && <p className="panel-copy">{t("Your accepted text stays in use until a new extraction succeeds.")}</p>}
    <div className="choice-row extraction-choices">{(["liteparse", "native", "layout", "ocr"] as ExtractionMethod[]).map((id) => {
      const title = t(methodLabel(id));
      return <Choice key={id} selected={method === id} onClick={() => { setMethod(id); void previewPage(page, id); }} title={title} badge={id === "liteparse" ? t("Recommended") : undefined} text={t(id === "ocr" ? "Reads text inside images and scans" : id === "liteparse" ? "Works well for most books" : id === "native" ? "Reads text saved in the PDF" : "For columns and unusual spacing")} detailLabel={t("About {{title}}", { title })} detail={t(id === "ocr" ? "Recognizes printed English text in images. Takes longer; compare the result for recognition mistakes." : id === "liteparse" ? "Fast and reliable for most books. Preserves paragraphs and reading order." : id === "native" ? "Try this if the standard method misses or changes words in a digital PDF." : "Handles complex columns and spacing. Try it if text appears out of order; it takes longer.")} />;
    })}</div>
    <div className="sample-reasons">{representatives.map((row) => <button key={row.page} aria-pressed={row.page === page} className={row.page === page ? "selected" : ""} onClick={() => void previewPage(row.page)}><b>{t("p. {{page}}", { page: row.page })}</b><span>{t(row.reason, { defaultValue: row.reason })}</span></button>)}</div>
    <Panel variant="plain" title={t("Page {{page}} of {{count}}", { page, count: extractionPreview?.pageCount ?? book?.pageCount ?? "?" })}><PageComparison className="extract-page-comparison" imageUrl={extractionPreview?.imageUrl} imageAlt={t("Original page {{page}}", { page })} rightLabel={t("{{method}} TEXT", { method: t(methodLabel(method)) })}><pre>{extractionPreview?.text}</pre></PageComparison></Panel>
    <div className="phase-action extract-final-action"><button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t("Process complete book")} →</button></div>
  </>;

}
