import {
  type HTMLAttributes,
  type RefObject,
} from "react";
import { useDialogFocus } from "./useDialogFocus";
import { useModalScrollLock } from "./useModalScrollLock";
import "./dialog-surface.css";

export type DialogSurfaceProps = Omit<
  HTMLAttributes<HTMLElement>,
  "role" | "tabIndex"
> & {
  as?: "section" | "div";
  onDismiss?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
  surfaceRef?: RefObject<HTMLElement | null>;
};

/** Shared modal keyboard lifecycle; progress dialogs deliberately omit onDismiss. */
export function DialogSurface({
  as: Surface = "section",
  onDismiss,
  initialFocusRef,
  returnFocusRef,
  lockScroll = true,
  surfaceRef,
  className,
  ...props
}: DialogSurfaceProps) {
  const ref = useDialogFocus(onDismiss, initialFocusRef, returnFocusRef);
  useModalScrollLock(lockScroll);
  return (
    <Surface
      {...props}
      ref={(element) => { ref.current = element; if (surfaceRef) surfaceRef.current = element; }}
      className={["dialog-surface", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    />
  );
}
