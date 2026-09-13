import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CastingPreview, CastProcessSettings, WorkflowGateway } from "../api/contracts";
import "./CastingChoice.css";

interface Props {
  action?: ReactNode;
  gateway: WorkflowGateway;
  bookId: string;
  settings: CastProcessSettings;
  onSourcesChange: (ids: string[]) => void;
  onModelChange: (id: string) => void;
  onReadyChange: (ready: boolean, fingerprint?: string) => void;
}

export function CastingChoice({ action, gateway, bookId, settings, onSourcesChange, onModelChange, onReadyChange }: Props) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<{ key: string; preview: CastingPreview }>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reuseOpen, setReuseOpen] = useState(!!settings.sourceBookIds?.length);
  const savedSources = useRef(settings.sourceBookIds ?? []);
  const key = JSON.stringify({ bookId, settings });
  const current = result?.key === key;
  const preview = result?.preview;
  const selected = settings.sourceBookIds ?? [];
  const activeOption = preview?.options?.find((option) => option.modelId === settings.voiceModel);
  const quoteAvailable = activeOption?.estimatedCostMinor != null && Number.isFinite(activeOption.estimatedCostMinor) && activeOption.estimatedCostMinor >= 0 && !!preview?.currency;
  useEffect(() => {
    let disposed = false;
    setError(false);
    const request = JSON.parse(key) as { bookId: string; settings: CastProcessSettings };
    const timer = window.setTimeout(() => {
      gateway.previewCasting!(request.bookId, request.settings).then((next) => {
        if (!disposed) setResult({ key, preview: next });
      }).catch(() => { if (!disposed) setError(true); });
    }, 150);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [gateway, key, retry]);
  useEffect(() => {
    const ready = !!current && quoteAvailable && !error && (!reuseOpen || selected.length > 0);
    onReadyChange(ready, ready ? preview?.fingerprint : undefined);
  }, [current, quoteAvailable, error, reuseOpen, selected.length, preview?.fingerprint, onReadyChange]);

  const sourceBooks = [...(preview?.sources ?? [])].sort((a, b) => a.title.localeCompare(b.title, i18n.language, { numeric: true }) || a.bookId.localeCompare(b.bookId));
  function changeSources(ids: string[]) {
    const selection = [...ids].sort();
    savedSources.current = selection;
    onReadyChange(false);
    onSourcesChange(selection);
  }
  function chooseModel(id: string) {
    if (reuseOpen) {
      savedSources.current = selected;
      setReuseOpen(false);
      onSourcesChange([]);
      onReadyChange(false);
    }
    if (settings.voiceModel !== id) { onReadyChange(false); onModelChange(id); }
  }
  function openReuse() {
    if (reuseOpen) return;
    setReuseOpen(true);
    onReadyChange(false);
    onSourcesChange(savedSources.current);
  }
  return <section className="casting-choice" aria-label={t("Casting options")} aria-busy={!current && !error}>
    <div className={`casting-options${sourceBooks.length ? " has-reuse" : ""}${reuseOpen ? " reuse-open" : ""}`}>
      {preview?.options?.map((option) => {
        const sentences = t(option.description).match(/[^.!?。！？]+[.!?。！？]?/g) ?? [t(option.description)];
        return <button type="button" key={option.modelId} aria-pressed={!reuseOpen && settings.voiceModel === option.modelId} className={`casting-option${!reuseOpen && settings.voiceModel === option.modelId ? " selected" : ""}`} onClick={() => chooseModel(option.modelId)}>
        <span className="casting-option-heading"><b>{t(option.label)}</b><span aria-hidden="true" className="casting-radio">{!reuseOpen && settings.voiceModel === option.modelId ? "●" : "○"}</span></span>
        {!reuseOpen && <><span className="casting-option-description">{sentences[0].trim()}</span>{sentences.length > 1 && <small>{sentences.slice(1).join(" ").trim()}</small>}</>}
      </button>; })}
      {!!sourceBooks.length && <button type="button" className={`casting-option casting-reuse-option${reuseOpen ? " selected" : ""}`} aria-pressed={reuseOpen} onClick={openReuse}>
        <span className="casting-option-heading"><b>{t("Reuse voices")}</b><span aria-hidden="true" className="casting-radio">{reuseOpen ? "●" : "○"}</span></span>
        {!reuseOpen && <><span className="casting-option-description">{t("Bring familiar voices into this book.")}</span><small>{t("Create new voices where needed.")}</small></>}
      </button>}
    </div>
    {reuseOpen && <div className="casting-reuse">
      <div className="casting-library-heading"><b>{t("Use voices from")}</b><small>{t("{{count}} selected", { count: selected.length })}</small></div>
      <div className="casting-books" tabIndex={0} role="region" aria-label={t("Books with reusable voices")}>
        {sourceBooks.map((source) => {
          const checked = selected.includes(source.bookId);
          return <div className={`casting-book${checked ? " selected" : ""}`} key={source.bookId}>
            <label><span className="casting-book-spine" aria-hidden="true" /><span className="casting-book-title" title={source.title}>{source.title}</span><small>{t("{{count}} voices", { count: source.voiceCount })}</small><input type="checkbox" checked={checked} onChange={() => changeSources(checked ? selected.filter((id) => id !== source.bookId) : [...selected, source.bookId])} /></label>
          </div>;
        })}
      </div>
      <div className="casting-match-summary" aria-live="polite">
        {current && selected.length > 0 ? <><p><span>{t("{{count}} exact matches", { count: preview!.exactMatchCount })}</span><span aria-hidden="true"> · </span><span>{t("Up to {{count}} new voices", { count: preview!.remainingVoiceCount })}</span></p><small>{t("AI checks for more matches when you continue.")}</small></> : <small>{t(selected.length ? "Checking exact matches…" : "Choose books to keep familiar voices.")}</small>}
      </div>
      <div className="casting-remainder"><span>{t("For new voices")}</span><div className="casting-quality" role="group" aria-label={t("Casting for new voices")}>{preview?.options?.map((option) => <button key={option.modelId} type="button" aria-pressed={settings.voiceModel === option.modelId} onClick={() => { if (settings.voiceModel !== option.modelId) { onReadyChange(false); onModelChange(option.modelId); } }}>{t(option.label)}</button>)}</div></div>
      {activeOption && <p className="casting-quality-description">{t(activeOption.description)}</p>}
    </div>}
    <footer className="casting-footer"><div className="casting-estimate" aria-live="polite">
      {error || (current && !quoteAvailable) ? <div role="alert" className="casting-preview-error">{t("Couldn’t calculate casting cost.")} <button type="button" className="ghost compact" onClick={() => { onReadyChange(false); setRetry((value) => value + 1); }}>{t("Retry")}</button></div> : !current ? <div className="casting-loading" role="status">{t("Calculating…")}</div> : activeOption?.estimatedCostMinor != null && preview?.currency ? <><div><strong>{new Intl.NumberFormat(i18n.language, { style: "currency", currency: preview.currency }).format(activeOption.estimatedCostMinor / 100)}</strong><small>{t("estimated")}</small></div><small>{t(reuseOpen ? "For new voices. Includes an allowance." : "Initial voice creation. Includes an allowance.")}</small></> : null}
    </div>{action}</footer>
  </section>;
}
