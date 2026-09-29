import { useEffect, useRef, useState } from "react";

/** Compact a bottom-sticky action dock until its natural position enters view. */
export function useFloatingActionDock() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    const output = anchor?.parentElement;
    if (!anchor || !output) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const viewportBottom = window.innerHeight - 12;
        const outputTop = output.getBoundingClientRect().top;
        const naturalTop = anchor.getBoundingClientRect().top;
        setFloating(outputTop < viewportBottom - 64 && naturalTop > viewportBottom - 100);
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(output);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return { anchorRef, floating };
}
