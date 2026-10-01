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
  const unavailable = languages.length === 0;
  const selectedUnavailable = !!language && !languages.includes(language);
  return <div className="narration-language-picker">
    <div className="narration-language-control">
      <span className="narration-language-flag" aria-hidden="true">{language ? languageFlags[language] ?? "🌐" : "🌐"}</span>
      <select aria-label={t("Narration language")} value={language} disabled={unavailable} onChange={(event) => {
        if (languages.includes(event.currentTarget.value)) onChange(event.currentTarget.value);
      }}>
        <option value="" disabled>{t(unavailable ? "Languages unavailable" : "Choose language")}</option>
        {selectedUnavailable && <option value={language} disabled>{t(language)} · {t("Unavailable")}</option>}
        {languages.map((row) => <option key={row} value={row}>{t(row)}</option>)}
      </select>
      <svg className="narration-language-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
    {unavailable && <small className="narration-language-unavailable" role="status">{t("No narration languages available.")}</small>}
  </div>;
}
