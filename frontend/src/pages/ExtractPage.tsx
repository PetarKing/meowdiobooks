import type {
  ExtractionMethod
} from "../api/contracts";
import type { WorkflowModel } from "../app/useWorkflowModel";
import brandMark from "../assets/brand/meowdiobooks-mark.png";
import { Choice, Panel, Tag } from "../components/Ui";
import { AcceptedSummary, PageComparison, StepEyebrow } from "../pages/shared";
import { methodLabel } from "./helpers";

export type ExtractPageModel = Pick<WorkflowModel, "book" | "busy" | "completed" | "extractionPreview" | "method" | "previewPage" | "processAndPublishExtraction" | "representatives" | "revisingStages" | "setMethod" | "setRevisingStages" | "snapshot" | "t">;

export function ExtractPage({ model }: { model: ExtractPageModel; }) {
  const { book, busy, completed, extractionPreview, method, previewPage, processAndPublishExtraction, representatives, revisingStages, setMethod, setRevisingStages, snapshot, t } = model;
  const page = extractionPreview?.page ?? 1;
  if (completed.includes("extract") && !revisingStages.includes("extract")) return <AcceptedSummary stage="extract" step={t("Step 1")} title={t("Extraction complete")} revision={snapshot?.activeArtifacts.extraction} onRevise={() => setRevisingStages([...new Set([...revisingStages, "extract"])])}><span><b>{book?.pageCount ?? "—"}</b><small>{t("Pages extracted")}</small></span><span><b>{t(methodLabel(method))}</b><small>{t("Selected parser")}</small></span><span><b>{t("Accepted")}</b><small>{t("Current result")}</small></span></AcceptedSummary>;
  return <><section className="extract-hero">
    <div className="extract-hero-copy"><StepEyebrow stage="extract">{t("Step 1 · Extract")}</StepEyebrow><h1>{t("Did we read the source correctly?")}</h1><p>{t("Compare the sample pages, choose a parser, then extract the full book.")}</p></div>
    <div className="extract-hero-art" aria-hidden="true"><span className="extract-page-card">PDF</span><span className="extract-spark">✦</span><span className="extract-text-card"><img src={brandMark} alt="" /><i /><i /><i /><i /></span></div>
  </section>
    {completed.includes("extract") && <Panel eyebrow={t("Accepted extraction")} title={t("Current extraction")} actions={<Tag tone="good">{t("Accepted")}</Tag>}><p className="panel-copy">{t("Your accepted text stays in use until a new extraction succeeds.")}</p></Panel>}
    <div className="choice-row extraction-choices">{(["liteparse", "native", "layout"] as ExtractionMethod[]).map((id) => {
      const title = t(id === "liteparse" ? "LiteParse" : id === "native" ? "Native PDF text" : "Layout-aware");
      return <Choice key={id} selected={method === id} onClick={() => { setMethod(id); void previewPage(page, id); }} title={title} badge={id === "liteparse" ? t("Recommended") : undefined} text={t(id === "liteparse" ? "Fast spatial parser" : id === "native" ? "Embedded text fallback" : "Slower layout-preserving fallback")} detailLabel={t("About {{title}}", { title })} detail={t(id === "liteparse" ? "Fast and reliable for most books. Preserves paragraphs and reading order." : id === "native" ? "Reads embedded PDF text. Try it if LiteParse misses or changes words in a digital PDF." : "Handles complex columns and spacing. Try it if text appears out of order; it takes longer.")} />;
    })}</div>
    <div className="sample-reasons">{representatives.map((row) => <button key={row.page} aria-pressed={row.page === page} className={row.page === page ? "selected" : ""} onClick={() => void previewPage(row.page)}><b>{t("p. {{page}}", { page: row.page })}</b><span>{t(row.reason, { defaultValue: row.reason })}</span></button>)}</div>
    <Panel title={t("Page {{page}} of {{count}}", { page, count: extractionPreview?.pageCount ?? book?.pageCount ?? "?" })}><PageComparison imageUrl={extractionPreview?.imageUrl} imageAlt={t("Original page {{page}}", { page })} rightLabel={t("{{method}} TEXT", { method: method.toUpperCase() })}><pre>{extractionPreview?.text}</pre></PageComparison></Panel>
    <div className="phase-action extract-final-action"><button className="primary" disabled={busy} onClick={() => void processAndPublishExtraction()}>{t("Process complete book")} →</button></div>
  </>;

}
