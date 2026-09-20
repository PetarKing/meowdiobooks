import { useEffect, useRef, type RefObject } from "react";

const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex], audio[controls], video[controls]';

/** One keyboard/focus lifecycle for modal surfaces and inspector variants. */
export function useDialogFocus(
  onClose?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined);
    // Child effects run before parent effects. A parent mounted together with
    // a nested modal must not take focus back from that modal.
    const mountedModals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    if (mountedModals.item(mountedModals.length - 1) === dialog) {
      (initialFocusRef?.current ?? dialog).focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      // A nested modal owns its keyboard interaction until it closes.
      const modals = Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
      );
      if (modals.at(-1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      } else if (event.key === "Tab") {
        const controls = Array.from(
          dialog!.querySelectorAll<HTMLElement>(focusableSelector),
        ).filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.tabIndex >= 0 &&
            (typeof element.checkVisibility !== "function" ||
              element.checkVisibility()) &&
            !element.closest("[hidden], [inert]") &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog!.focus();
        } else if (
          active === dialog ||
          !dialog!.contains(active) ||
          (event.shiftKey ? active === first : active === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Preserve explicit post-decision focus (for example, a newly merged cast tile).
      if (
        trigger?.isConnected &&
        (document.activeElement === document.body ||
          dialog.contains(document.activeElement))
      )
        trigger.focus();
    };
  }, [initialFocusRef, returnFocusRef]);
  return ref;
}
