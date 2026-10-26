import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CastingPreview, CastProcessSettings, WorkflowGateway, WizardSnapshot } from "../api/contracts";
import { localizeErrorMessage, message } from "../workflow/presentation";
import "./CastingChoice.css";

interface Props {
  action?: ReactNode;
  gateway: WorkflowGateway;
  bookId: string;
  settings: CastProcessSettings;
  models?: WizardSnapshot["voiceModels"];
  showVoiceModelControls?: boolean;
  onModelChange: (id: string) => void;
  onReadyChange: (ready: boolean, fingerprint?: string) => void;
}

export function CastingChoice({ action, gateway, bookId, settings, models = [], showVoiceModelControls = true, onModelChange, onReadyChange }: Props) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<{ key: string; preview: CastingPreview }>();
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify({ bookId, settings });
  const current = result?.key === key && !loading;
  const preview = result?.preview;
  // Catalog choices remain usable even if the first quote fails.
  const options = preview?.options?.length ? preview.options : models.map((model) => ({ modelId: model.id, label: model.label, description: "" }));
  const activeOption = preview?.options?.find((option) => option.modelId === settings.voiceModel);
  const quoteAvailable = activeOption?.estimatedCostMinor != null && Number.isFinite(activeOption.estimatedCostMinor) && activeOption.estimatedCostMinor >= 0 && !!preview?.currency;
  useEffect(() => {
    let disposed = false;
    setError(false);
    setErrorDetail(undefined);
    setLoading(true);
    const request = JSON.parse(key) as { bookId: string; settings: CastProcessSettings };
    const timer = window.setTimeout(() => {
      gateway.previewCasting!(request.bookId, request.settings).then((next) => {
        if (!disposed) { setResult({ key, preview: next }); setLoading(false); }
      }).catch((reason: unknown) => {
        if (disposed) return;
        setError(true);
        setLoading(false);
        if (reason instanceof Error && "status" in reason && reason.status === 422) setErrorDetail(message(reason));
      });
    }, 150);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [gateway, key, retry]);
  useEffect(() => {
    const ready = !!current && quoteAvailable && !error;
    onReadyChange(ready, ready ? preview?.fingerprint : undefined);
  }, [current, quoteAvailable, error, preview?.fingerprint, onReadyChange]);

  function chooseModel(id: string) {
    if (settings.voiceModel !== id) { onReadyChange(false); onModelChange(id); }
  }
  return <section className="casting-choice" aria-label={t("Casting options")} aria-busy={!current && !error}>
    {showVoiceModelControls && <div className="casting-options">{options.map((option) => <button type="button" key={option.modelId} aria-pressed={settings.voiceModel === option.modelId} className={`casting-option${settings.voiceModel === option.modelId ? " selected" : ""}`} onClick={() => chooseModel(option.modelId)}><b>{t(option.label)}</b><span className="casting-option-description">{t(option.description)}</span></button>)}</div>}
    <footer className="casting-footer"><div className="casting-estimate" aria-live="polite">
      {error || (current && !quoteAvailable) ? <div role="alert" className="casting-preview-error"><span>{t("Couldn’t calculate casting cost.")}{errorDetail && <small className="casting-error-detail">{localizeErrorMessage(errorDetail, t)}</small>}</span><button type="button" className="ghost compact" onClick={() => { onReadyChange(false); setRetry((value) => value + 1); }}>{t("Retry")}</button></div> : !current ? <div className="casting-loading" role="status">{t("Calculating…")}</div> : activeOption?.estimatedCostMinor != null && preview?.currency ? <div aria-label={t("Estimated cost")}><strong>≈ {new Intl.NumberFormat(i18n.language, { style: "currency", currency: preview.currency }).format(activeOption.estimatedCostMinor / 100)}</strong></div> : null}
    </div>{action}</footer>
  </section>;
}
