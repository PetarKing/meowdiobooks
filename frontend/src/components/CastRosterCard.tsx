import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from "react";

interface CastRosterCardProps {
  name: string;
  symbol: string;
  detail?: ReactNode;
  badge?: ReactNode;
  portraitContent?: ReactNode;
  portraitCue?: ReactNode;
  cardClassName?: string;
  portraitClassName?: string;
  detailClassName?: string;
  dataSharedVoiceGroup?: string;
  style?: CSSProperties;
  inspectRef?: Ref<HTMLButtonElement>;
  inspectProps: ButtonHTMLAttributes<HTMLButtonElement>;
  previewProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

/** The same roster card has one inspect target in Cast and separate play/inspect targets in Voices. */
export function CastRosterCard({
  name, symbol, detail, badge, portraitContent, portraitCue, cardClassName = "",
  portraitClassName = "", detailClassName = "", dataSharedVoiceGroup, style, inspectRef, inspectProps, previewProps,
}: CastRosterCardProps) {
  const portrait = portraitContent ?? <strong aria-hidden="true">{symbol}</strong>;
  const details = <><span className="cast-roster-name">{name}</span><span className="cast-roster-subline">{detail && <small className="cast-roster-meta">{detail}</small>}{badge && <span className="cast-roster-review">{badge}</span>}</span></>;
  const curve = <svg className="cast-roster-curve" aria-hidden="true" viewBox="0 0 120 120" preserveAspectRatio="none">
    <path className="cast-roster-field field-horizontal" d="M26 -12 C102 26 111 69 17 134 L220 134 L220 -12 Z" />
    <path className="cast-roster-field field-vertical" d="M-15 10 C10 118 110 118 135 10 L135 -90 L-15 -90 Z" />
    <path className="curve-horizontal" d="M26 -12 C102 26 111 69 17 134" />
    <path className="curve-vertical" d="M-15 10 C10 118 110 118 135 10" />
  </svg>;

  if (!previewProps) {
    return <button {...inspectProps} ref={inspectRef} type="button" style={style}
      className={`cast-tile cast-roster-card cast-roster-identity ${cardClassName} ${inspectProps.className ?? ""}`}>
      <span className="cast-roster-copy">{details}</span>
      {curve}
      <span className={`cast-roster-portrait ${portraitClassName}`}>{portrait}</span>
    </button>;
  }

  return <div className={`cast-tile-shell cast-roster-card ${cardClassName}`}>
    <button {...inspectProps} ref={inspectRef} type="button" style={style} data-shared-voice-group={dataSharedVoiceGroup}
      className={`cast-tile voice-cast-tile cast-roster-copy cast-roster-details ${detailClassName} ${inspectProps.className ?? ""}`}>
      {details}
    </button>
    {curve}
    <button {...previewProps} type="button" className={`voice-tile-portrait cast-roster-portrait ${portraitClassName} ${previewProps.className ?? ""}`}>
      {portrait}{portraitCue}
    </button>
  </div>;
}
