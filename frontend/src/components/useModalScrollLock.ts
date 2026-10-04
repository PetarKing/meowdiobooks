import { useEffect } from "react";

import { modalLifecycle } from "./modalLifecycle";

/** Shared by portal surfaces and hosts retaining native modal dialogs. */
export function useModalScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const lifecycle = modalLifecycle();
    const token = Symbol("modal-scroll-lock");
    const firstLock = lifecycle.scrollLocks.size === 0;
    lifecycle.scrollLocks.add(token);
    if (firstLock) {
      const root = document.documentElement;
      const body = document.body;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const properties = ["overflow", "position", "top", "left", "width", "padding-right"];
      const saved = properties.map((name) => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
      const rootStyles = ["overflow", "scrollbar-gutter"].map((name) => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
      const scrollbar = root.clientWidth > 0 ? Math.max(0, window.innerWidth - root.clientWidth) : 0;
      // Stable classic scrollbar gutters remain reserved even with hidden
      // overflow, leaving a right-hand strip outside fixed modal backdrops.
      root.style.setProperty("scrollbar-gutter", "auto", "important");
      root.style.setProperty("overflow", "hidden", "important");
      body.style.setProperty("overflow", "hidden", "important");
      // A fixed body also blocks touch scrolling on mobile Safari, where overflow
      // alone can leave the document scrollable behind a modal.
      body.style.setProperty("position", "fixed", "important");
      body.style.setProperty("top", `${-scrollY}px`, "important");
      body.style.setProperty("left", `${-scrollX}px`, "important");
      body.style.setProperty("width", "100%", "important");
      if (scrollbar) body.style.setProperty("padding-right", `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`, "important");
      lifecycle.restoreScroll = () => {
        for (const [name, value, priority] of saved) body.style.setProperty(name, value, priority);
        for (const [name, value, priority] of rootStyles) root.style.setProperty(name, value, priority);
        if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
      };
    }
    return () => {
      lifecycle.scrollLocks.delete(token);
      if (lifecycle.scrollLocks.size === 0) {
        lifecycle.restoreScroll?.();
        lifecycle.restoreScroll = undefined;
      }
    };
  }, [enabled]);
}
