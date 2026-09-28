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
  const contents = <><b>{name}</b>{badge}{detail && <small>{detail}</small>}</>;

  if (!previewProps) {
    return <button {...inspectProps} ref={inspectRef} type="button" style={style}
      className={`cast-tile cast-roster-card cast-roster-identity ${cardClassName} ${inspectProps.className ?? ""}`}>
      <span className={`cast-roster-portrait ${portraitClassName}`}>{portrait}</span>
      <span className="cast-roster-details">{contents}</span>
    </button>;
  }

  return <div className={`cast-tile-shell cast-roster-card ${cardClassName}`}>
    <button {...previewProps} type="button" className={`voice-tile-portrait cast-roster-portrait ${portraitClassName} ${previewProps.className ?? ""}`}>
      {portrait}{portraitCue}
    </button>
    <button {...inspectProps} ref={inspectRef} type="button" style={style} data-shared-voice-group={dataSharedVoiceGroup}
      className={`cast-tile voice-cast-tile cast-roster-details ${detailClassName} ${inspectProps.className ?? ""}`}>
      {contents}
    </button>
  </div>;
}
