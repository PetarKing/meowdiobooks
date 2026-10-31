import { useLayoutEffect, useRef } from "react";

/** Move to the start of a newly navigated screen, never on refresh/poll updates. */
export function usePageNavigation(key: string) {
  const main = useRef<HTMLElement>(null);
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    main.current?.focus({ preventScroll: true });
  }, [key]);
  return main;
}
