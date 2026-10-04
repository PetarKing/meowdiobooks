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
      const rootOverflow = [root.style.getPropertyValue("overflow"), root.style.getPropertyPriority("overflow")];
      const scrollbar = root.clientWidth > 0 ? Math.max(0, window.innerWidth - root.clientWidth) : 0;
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
        root.style.setProperty("overflow", rootOverflow[0], rootOverflow[1]);
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
