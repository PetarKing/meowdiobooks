import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageToggle } from "./components/LanguageToggle";
import i18n, {
  changeAppLocale,
  localePreferenceKey,
  normalizeAppLocale,
  publicEditionTranslations,
  registerEditionTranslations,
} from "./i18n";
import { reviewConsequence } from "./workflow/review";

describe("interface localization", () => {
  afterEach(async () => {
    registerEditionTranslations(publicEditionTranslations);
    localStorage.clear();
    await changeAppLocale("en");
    localStorage.clear();
  });

  it("normalizes English and Chinese browser locale variants", () => {
    expect(normalizeAppLocale("en-GB")).toBe("en");
    expect(normalizeAppLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeAppLocale("pt-BR")).toBeUndefined();
  });

  it("persists a language choice and updates the document locale", async () => {
    await changeAppLocale("zh-CN");

    expect(localStorage.getItem(localePreferenceKey)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(i18n.t("Create")).toBe("制作");
  });

  it("switches languages through the visible toggle", async () => {
    await changeAppLocale("en");
    render(<LanguageToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Switch interface to Simplified Chinese" }));

    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(screen.getByRole("group", { name: "界面语言" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换界面为简体中文" })).toHaveAttribute("aria-pressed", "true");
  });

  it("localizes Review evidence, dynamic consequences, and extraction sample labels", async () => {
    await changeAppLocale("zh-CN");
    const pageNumberWarning = {
      id: "page-number",
      kind: "page-number",
      detail: "Printed page number",
      severity: "warning" as const,
      readerState: "narrator" as const,
      availableActions: ["exclude" as const],
      occurrences: [
        { id: "page-1", page: 1, source: "1", text: "1" },
        { id: "page-2", page: 2, source: "2", text: "2" },
      ],
    };

    expect(i18n.t("Page number")).toBe("页码");
    expect(i18n.t("Review rules and examples")).toBe("查看规则与示例");
    expect(i18n.t("opening page")).toBe("开篇页");
    expect(reviewConsequence("exclude", pageNumberWarning, i18n.t)).toBe(
      "全部 2 处高亮文本不会被朗读。PDF 原文件保持不变。",
    );
  });

  it("overrides only the edition namespace for every supported locale", async () => {
    registerEditionTranslations({
      en: { ...publicEditionTranslations.en, "processing.contextLabel": "Working in custom English" },
      "zh-CN": { ...publicEditionTranslations["zh-CN"], "processing.contextLabel": "正在使用自定义中文" },
    });

    expect(i18n.t("processing.contextLabel", { ns: "edition" })).toBe("Working in custom English");
    await changeAppLocale("zh-CN");
    expect(i18n.t("processing.contextLabel", { ns: "edition" })).toBe("正在使用自定义中文");
    expect(i18n.t("Create")).toBe("制作");
  });
});
