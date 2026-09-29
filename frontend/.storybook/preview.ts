import "../src/styles/product.css";
import "./preview.css";
import type { Preview } from "@storybook/react-vite";
import i18n, { localePreferenceKey } from "../src/i18n";
import { sidebarPreferenceKey } from "../src/workflow/navigation";
const previewPath = window.location.pathname;
const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    // Every story is part of the collaboration surface. Accessibility
    // regressions fail the browser suite instead of remaining advisory.
    a11y: { test: "error" },
    options: {
      storySort: { order: ["Foundations", "Components", "Pages", "Workflow"] },
    },
  },
  beforeEach: async () => {
    const keys = [
      localePreferenceKey,
      sidebarPreferenceKey,
      "meowdiobooks.activeJob",
    ];
    const stored = new Map(keys.map((key) => [key, localStorage.getItem(key)]));
    const locale = i18n.language;
    keys.forEach((key) => localStorage.removeItem(key));
    await i18n.changeLanguage("en");
    window.history.replaceState(
      window.history.state,
      "",
      previewPath + window.location.search,
    );
    // App owns product routing, but must not replace Storybook's iframe URL.
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    window.history.pushState = () => {};
    window.history.replaceState = () => {};
    return async () => {
      await i18n.changeLanguage(locale);
      window.history.pushState = push;
      window.history.replaceState = replace;
      replace.call(
        window.history,
        window.history.state,
        "",
        previewPath + window.location.search,
      );
      stored.forEach((value, key) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
    };
  },
};
export default preview;
