import { useTranslation } from "react-i18next";
import { changeAppLocale, normalizeAppLocale, type AppLocale } from "../i18n";

const choices: Array<{ locale: AppLocale; short: string; label: string }> = [
  { locale: "en", short: "EN", label: "English" },
  { locale: "zh-CN", short: "中文", label: "简体中文" },
];

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const active = normalizeAppLocale(i18n.resolvedLanguage) ?? "en";

  return <div className="language-toggle" role="group" aria-label={t("Interface language")}>
    {choices.map((choice) => <button
      key={choice.locale}
      type="button"
      className={active === choice.locale ? "active" : ""}
      aria-pressed={active === choice.locale}
      aria-label={t(choice.locale === "en" ? "Switch interface to English" : "Switch interface to Simplified Chinese")}
      title={choice.label}
      onClick={() => void changeAppLocale(choice.locale)}
    >{choice.short}</button>)}
  </div>;
}
