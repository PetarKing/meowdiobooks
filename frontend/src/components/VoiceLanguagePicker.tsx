import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageFlags } from "./LanguagePicker";
import "./VoiceLanguagePicker.css";

interface Props {
  languages: string[];
  language: string;
  onChange: (language: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function VoiceLanguagePicker({ languages, language, onChange, expanded, onExpandedChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(0);
  const search = useRef({ text: "", time: 0 });
  const unavailable = languages.length === 0;
  const activeIndex = Math.min(active, Math.max(0, languages.length - 1));

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onExpandedChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded, onExpandedChange]);
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, id, activeIndex]);

  function open() {
    setActive(Math.max(0, languages.indexOf(language)));
    onExpandedChange(true);
  }
  function choose(value: string) {
    if (!languages.includes(value)) return;
    onChange(value);
    onExpandedChange(false);
    trigger.current?.focus();
  }
  return <div ref={root} className="voice-language-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onExpandedChange(false);
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={t("Narration language")} aria-haspopup="listbox" aria-expanded={expanded && !unavailable} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded && !unavailable ? `${id}-${activeIndex}` : undefined} value={language} disabled={unavailable} className="voice-language-trigger" onClick={() => expanded ? onExpandedChange(false) : open()} onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); onExpandedChange(false); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!expanded) open();
        else setActive(event.key === "Home" ? 0 : event.key === "End" ? languages.length - 1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + languages.length) % languages.length);
      } else if (expanded && ["Enter", " "].includes(event.key)) {
        event.preventDefault(); choose(languages[activeIndex]);
      } else if (event.key === "Tab") onExpandedChange(false);
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
        event.preventDefault();
        const now = Date.now();
        search.current = { text: now - search.current.time < 700 ? search.current.text + event.key : event.key, time: now };
        const index = languages.findIndex((row) => t(row).toLocaleLowerCase().startsWith(search.current.text.toLocaleLowerCase()));
        if (index >= 0) { setActive(index); onExpandedChange(true); }
      }
    }}>
      <span aria-hidden="true" className="voice-language-flag">{languageFlags[language] ?? "🌐"}</span>
      <span>{t(unavailable ? "Languages unavailable" : language || "Choose language")}{language && !languages.includes(language) && ` · ${t("Unavailable")}`}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d={expanded ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {expanded && !unavailable && <ul id={id} role="listbox" aria-label={t("Narration languages")} className="voice-language-options">{languages.map((row, index) => <li key={row} id={`${id}-${index}`} role="option" aria-selected={language === row} className={index === activeIndex ? "active" : ""} onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(row)}><span aria-hidden="true" className="voice-language-flag">{languageFlags[row] ?? "🌐"}</span><span>{t(row)}</span>{language === row && <span className="voice-language-tick" aria-hidden="true">✓</span>}</li>)}</ul>}
    {unavailable && <small role="status">{t("No narration languages available.")}</small>}
  </div>;
}
