import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DialogueAttributionRoute, DialogueRoutingPreview } from "../api/contracts";
import { DialogSurface } from "./DialogSurface";

interface DialogueRoutingChoiceProps {
  routing: DialogueRoutingPreview;
  onChoose: (route: DialogueAttributionRoute) => void;
  onClose: () => void;
}

function LocalIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 15.5 16 6l11 9.5v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M12 27v-8h8v8M21.5 11.2v-3h3v5.6" /></svg>;
}

function LunaIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22.8 23.7A10.8 10.8 0 0 1 10.3 9.2 10.8 10.8 0 1 0 22.8 23.7Z" /><path d="m23 6 .8 2.2L26 9l-2.2.8L23 12l-.8-2.2L20 9l2.2-.8z" /></svg>;
}

function Benefit({ children }: { children: ReactNode }) {
  return <li><span aria-hidden="true">✓</span>{children}</li>;
}

function Tradeoff({ children }: { children: ReactNode }) {
  return <li><span aria-hidden="true">!</span>{children}</li>;
}

export function DialogueRoutingChoice({ routing, onChoose, onClose }: DialogueRoutingChoiceProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DialogueAttributionRoute>();
  const remote = routing.remote;
  const money = (value: number) => value <= 0 ? t("$0 API cost") : t("≈ ${{cost}} API cost", { cost: value.toFixed(2) });

  return <div className="dialogue-routing-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <DialogSurface className="dialogue-routing-modal" aria-labelledby="dialogue-routing-title" onDismiss={onClose}>
      <button className="dialogue-routing-close" type="button" aria-label={t("Close speaker-check choice")} onClick={onClose}>×</button>
      <header className="dialogue-routing-heading">
        <span className="eyebrow">{t("A lot to review")}</span>
        <h2 id="dialogue-routing-title">{t("{{count}} dialogue lines need a speaker check", { count: routing.targetCount.toLocaleString() })}</h2>
        <p>{t("dialogue.routingDescription", { ns: "edition" })}</p>
      </header>

      <div className="dialogue-routing-options">
        <article className={`dialogue-routing-card local${selected === "local" ? " selected" : ""}`}>
          <button type="button" className="dialogue-route-select" aria-pressed={selected === "local"} onClick={() => setSelected("local")}>
            <span className="dialogue-route-head">
              <span className="dialogue-route-icon"><LocalIcon /></span>
              <span><b>{routing.local.displayName}</b><small>{t("dialogue.localRuntime", { ns: "edition" })}</small></span>
            </span>
            <strong className="dialogue-route-price">{money(routing.local.apiCostUsd)}</strong>
            <span className="dialogue-route-section good"><b>{t("Benefits")}</b><ul>
              <Benefit>{t("dialogue.localBenefit", { ns: "edition" })}</Benefit>
              <Benefit>{t("Free to run")}</Benefit>
            </ul></span>
            <span className="dialogue-route-section caution"><b>{t("Trade-offs")}</b><ul>
              <Tradeoff>{t("May choose the wrong character")}</Tradeoff>
              <Tradeoff>{t("May miss a character and use Narrator")}</Tradeoff>
            </ul></span>
          </button>
          {selected === "local" && <button type="button" className="dialogue-route-proceed" onClick={() => onChoose("local")}>
            {t("Use {{model}}", { model: routing.local.displayName })} <i aria-hidden="true">→</i>
          </button>}
        </article>

        <article className={`dialogue-routing-card remote${selected === "remote" ? " selected" : ""}${remote?.credentialConfigured ? "" : " disabled"}`}>
          <button type="button" className="dialogue-route-select" aria-pressed={selected === "remote"} disabled={!remote?.credentialConfigured} onClick={() => setSelected("remote")}>
            <span className="dialogue-route-head">
              <span className="dialogue-route-icon"><LunaIcon /></span>
              <span><b>{remote?.displayName ?? t("Remote model")}</b><small>{remote?.domain ? t("Runs at {{domain}}", { domain: remote.domain }) : t("Remote API")}</small></span>
            </span>
            <strong className="dialogue-route-price">{money(remote?.estimatedCostUsd ?? 0)}</strong>
            <span className="dialogue-route-section good"><b>{t("Benefits")}</b><ul>
              <Benefit>{remote?.falseNamesReductionPercent == null ? t("Likely fewer speaker mistakes") : t("≈{{count}}% fewer incorrect names", { count: remote.falseNamesReductionPercent })}</Benefit>
              <Benefit>{remote?.speakerRecallImprovementPercent == null ? t("Likely to find more speakers") : t("≈{{count}}% more speakers identified", { count: remote.speakerRecallImprovementPercent })}</Benefit>
              <Benefit>{t("Likely faster for long books")}</Benefit>
            </ul></span>
            <span className="dialogue-route-section caution"><b>{t("Trade-offs")}</b><ul>
              <Tradeoff>{t("dialogue.remotePrivacyTradeoff", { ns: "edition" })}</Tradeoff>
              <Tradeoff>{t("dialogue.remoteBillingTradeoff", { ns: "edition" })}</Tradeoff>
            </ul></span>
          </button>
          {!remote?.credentialConfigured && <p className="dialogue-route-unavailable">{t("Remote model unavailable: API credentials are not configured.")}</p>}
          {selected === "remote" && remote?.credentialConfigured && <button type="button" className="dialogue-route-proceed remote" onClick={() => onChoose("remote")}>
            {t("Use {{model}}", { model: remote.displayName })} <i aria-hidden="true">→</i>
          </button>}
        </article>
      </div>

      <p className="dialogue-routing-privacy">{t("dialogue.routingPrivacyNote", { ns: "edition" })}</p>
    </DialogSurface>
  </div>;
}
