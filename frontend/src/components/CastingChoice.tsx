import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CastingPreview, CastProcessSettings, WorkflowGateway } from "../api/contracts";
import "./CastingChoice.css";

interface Props {
  gateway: WorkflowGateway;
  bookId: string;
  settings: CastProcessSettings;
  onSourcesChange: (ids: string[]) => void;
  onModelChange: (id: string) => void;
  onReadyChange: (ready: boolean, fingerprint?: string) => void;
}

export function CastingChoice({ gateway, bookId, settings, onSourcesChange, onModelChange, onReadyChange }: Props) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<{ key: string; preview: CastingPreview }>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reuseEnabled, setReuseEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const key = JSON.stringify({ bookId, settings });
  const current = result?.key === key;
  const preview = result?.preview;
  const selected = settings.sourceBookIds ?? [];
  useEffect(() => {
    let disposed = false;
    setError(false);
    onReadyChange(false);
    const request = JSON.parse(key) as { bookId: string; settings: CastProcessSettings };
    const timer = window.setTimeout(() => {
      gateway.previewCasting!(request.bookId, request.settings).then((next) => {
        if (disposed) return;
        setResult({ key, preview: next });
        onReadyChange(true, next.fingerprint);
      }).catch(() => { if (!disposed) setError(true); });
    }, 150);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [gateway, key, retry, onReadyChange]);

  const ordered = preview ? [
    ...selected.flatMap((id) => preview.sources.filter((source) => source.bookId === id)),
    ...preview.sources.filter((source) => !selected.includes(source.bookId)),
  ] : [];
  const reuseOpen = reuseEnabled || selected.length > 0;
  const visibleBooks = ordered.filter((source) => selected.includes(source.bookId) || source.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function changeSources(ids: string[]) { onReadyChange(false); onSourcesChange(ids); }
  return <section className="casting-choice" aria-label={t("Casting options")} aria-busy={!current && !error}>
    {!!ordered.length && <div className="casting-reuse">
      <header><label className="casting-reuse-toggle"><span>{t("Reuse voices from other books")}</span><input type="checkbox" role="switch" checked={reuseOpen} onChange={(event) => { setReuseEnabled(event.target.checked); if (!event.target.checked) { changeSources([]); setSearch(""); } }} /><span className="casting-switch" aria-hidden="true" /></label></header>
      {reuseOpen && <>
      <div className="casting-library-heading"><small>{t("{{selected}} selected · {{count}} books", { selected: selected.length, count: ordered.length })}</small>{current && selected.length > 0 && <span className="casting-match-count">{t("{{count}} exact matches", { count: preview!.exactMatchCount })}</span>}</div>
      {ordered.length >= 8 && <input className="casting-book-search" type="search" aria-label={t("Search books")} placeholder={t("Search books…")} value={search} onChange={(event) => setSearch(event.target.value)} />}
      <div className="casting-books" tabIndex={0} role="region" aria-label={t("Books with reusable voices")}>
        {visibleBooks.map((source) => {
          const rank = selected.indexOf(source.bookId);
          return <div className={`casting-book${rank >= 0 ? " selected" : ""}`} key={source.bookId}>
            <label><input type="checkbox" checked={rank >= 0} onChange={() => changeSources(rank >= 0 ? selected.filter((id) => id !== source.bookId) : [...selected, source.bookId])} /><span className="casting-book-rank" aria-hidden="true">{rank >= 0 ? rank + 1 : "—"}</span><span title={source.title}>{source.title}</span></label>
            {rank > 0 && <button type="button" className="ghost compact" aria-label={t("Move {{title}} up", { title: source.title })} title={t("Higher books win matching names")} onClick={() => { const ids = [...selected]; [ids[rank - 1], ids[rank]] = [ids[rank], ids[rank - 1]]; changeSources(ids); }}>↑</button>}
          </div>;
        })}
      </div>
      <div className="casting-library-footer">{selected.length > 0 ? <small>{t("Top book wins. AI checks other names when you continue.")}</small> : <small>{t("Choose books to keep familiar voices.")}</small>}{visibleBooks.length > 4 && <small className="casting-scroll-cue">{t("Scroll to browse")} ↓</small>}</div>
      {visibleBooks.length === 0 && <small role="status">{t("No books found.")}</small>}
      </>}
    </div>}
    <header className="casting-generation-heading"><h3>{t(selected.length ? "Create remaining voices" : "Create voices")}</h3>{current && <small>{t(selected.length ? "Up to {{count}} new voices" : "{{count}} voices · includes Narrator", { count: preview!.remainingVoiceCount })}</small>}</header>
    <div className="casting-options">
      {preview?.options?.map((option) => <button type="button" key={option.modelId} aria-pressed={settings.voiceModel === option.modelId} className={`casting-option${settings.voiceModel === option.modelId ? " selected" : ""}`} onClick={() => { if (settings.voiceModel !== option.modelId) { onReadyChange(false); onModelChange(option.modelId); } }}>
        <span className="casting-option-heading"><b>{t(option.label)}</b><span aria-hidden="true" className="casting-radio">{settings.voiceModel === option.modelId ? "●" : "○"}</span></span>
        <span>{t(option.description)}</span>
        {current && option.estimatedCostMinor != null && preview.currency && <strong>{t("≈ {{cost}}", { cost: new Intl.NumberFormat(i18n.language, { style: "currency", currency: preview.currency }).format(option.estimatedCostMinor / 100) })}</strong>}
      </button>)}
    </div>
    {error ? <div role="alert" className="casting-preview-error">{t("Couldn’t calculate casting cost.")} <button type="button" className="ghost compact" onClick={() => setRetry((value) => value + 1)}>{t("Retry")}</button></div> : !current ? <div className="casting-loading" role="status">{t("Calculating…")}</div> : <small>{t("Casting only. Audiobook audio is charged separately.")}</small>}
  </section>;
}
