import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN";

export const localePreferenceKey = "meowdiobooks.locale";
export const supportedLocales = ["en", "zh-CN"] as const;
export type AppLocale = (typeof supportedLocales)[number];

export function normalizeAppLocale(value: unknown): AppLocale | undefined {
  const locale = String(value ?? "").trim().toLowerCase();
  if (locale === "en" || locale.startsWith("en-")) return "en";
  if (locale === "zh" || locale.startsWith("zh-")) return "zh-CN";
  return undefined;
}

function savedLocale(): AppLocale | undefined {
  try {
    return normalizeAppLocale(localStorage.getItem(localePreferenceKey));
  } catch {
    return undefined;
  }
}

function preferredLocale(): AppLocale {
  return savedLocale() ?? normalizeAppLocale(navigator.language) ?? "en";
}

function applyDocumentLocale(locale: AppLocale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: {} },
      "zh-CN": { translation: zhCN },
    },
    lng: preferredLocale(),
    fallbackLng: "en",
    supportedLngs: [...supportedLocales],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false },
  })
  .then(() => applyDocumentLocale(normalizeAppLocale(i18n.resolvedLanguage) ?? "en"));

i18n.on("languageChanged", (language) => {
  applyDocumentLocale(normalizeAppLocale(language) ?? "en");
});

export async function changeAppLocale(locale: AppLocale) {
  try {
    localStorage.setItem(localePreferenceKey, locale);
  } catch {
    // The explicit choice still applies for this session when storage is unavailable.
  }
  await i18n.changeLanguage(locale);
}

export { zhCN };
export default i18n;
