import { useRef } from "react";
import { useTranslation } from "react-i18next";
import "./LanguagePicker.css";

export const languageFlags: Record<string, string> = {
  english: "🇬🇧", chinese: "🇨🇳", german: "🇩🇪", italian: "🇮🇹", portuguese: "🇵🇹",
  spanish: "🇪🇸", japanese: "🇯🇵", korean: "🇰🇷", french: "🇫🇷", russian: "🇷🇺",
};
interface LanguageProps {
  languages: string[];
  language: string;
  onChange: (language: string) => void;
}

export function LanguageFlags({ languages, language, onChange }: LanguageProps) {
  const { t } = useTranslation();
  return <fieldset className="language-flags"><legend>{t("Book language")}</legend>{languages.map((row) => <button type="button" key={row} className={language === row ? "selected" : ""} aria-pressed={language === row} title={t(row)} onClick={() => onChange(row)}><span aria-hidden="true">{languageFlags[row] ?? "🌐"}</span><small>{t(row)}</small></button>)}</fieldset>;
}

export function NarrationLanguagePicker({ languages, language, onChange }: LanguageProps) {
  const { t } = useTranslation();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  function close() {
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus();
  }
  return <details className="narration-language-picker" ref={disclosure} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
  }}>
    <summary ref={trigger} role="button" aria-label={t("Narration language")}>
      <span className="narration-language-value"><span aria-hidden="true">{language ? languageFlags[language] ?? "🌐" : "🌐"}</span><span>{t(language || "Choose language")}</span></span>
      <svg className="narration-language-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </summary>
    <div className="narration-language-menu"><LanguageFlags languages={languages} language={language} onChange={(value) => { onChange(value); close(); }} /></div>
  </details>;
}
