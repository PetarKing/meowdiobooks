import type { HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { usePresentationPortalAttributes } from "./presentationContext";
import "./dialog-surface.css";

export type DialogBackdropProps = HTMLAttributes<HTMLDivElement>;

/** Escape shell stacking contexts while preserving the originating visual scope. */
export function DialogBackdrop({ className = "dialog-backdrop", style, ...props }: DialogBackdropProps) {
  const presentation = usePresentationPortalAttributes();
  const backdrop = <div {...presentation} {...props}
    className={["dialog-portal", className].filter(Boolean).join(" ")}
    style={{ ...presentation.style, ...style }} />;
  return typeof document === "undefined" ? backdrop : createPortal(backdrop, document.body);
}
