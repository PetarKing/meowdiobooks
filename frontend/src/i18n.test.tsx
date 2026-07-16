import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageToggle } from "./components/LanguageToggle";
import i18n, { changeAppLocale, localePreferenceKey, normalizeAppLocale } from "./i18n";

describe("interface localization", () => {
  afterEach(async () => {
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
});
