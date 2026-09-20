import {
  useEffect,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { useDialogFocus } from "./useDialogFocus";
import "./dialog-surface.css";

// Reference counting also handles sibling dialogs unmounting out of order.
let scrollLocks = 0;
let previousOverflow = "";

export type DialogSurfaceProps = Omit<
  HTMLAttributes<HTMLElement>,
  "role" | "tabIndex"
> & {
  as?: "section" | "div";
  onDismiss?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
};

/** Shared modal keyboard lifecycle; progress dialogs deliberately omit onDismiss. */
export function DialogSurface({
  as: Surface = "section",
  onDismiss,
  initialFocusRef,
  returnFocusRef,
  lockScroll = true,
  className,
  ...props
}: DialogSurfaceProps) {
  const ref = useDialogFocus(onDismiss, initialFocusRef, returnFocusRef);
  useEffect(() => {
    if (!lockScroll) return;
    if (scrollLocks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [lockScroll]);
  return (
    <Surface
      {...props}
      ref={ref as RefObject<HTMLDivElement | null>}
      className={["dialog-surface", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    />
  );
}
