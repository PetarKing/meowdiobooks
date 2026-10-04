import { useEffect, useRef, type RefObject } from "react";
import { modalLifecycle } from "./modalLifecycle";

const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex], audio[controls], video[controls]';

function topSurface() {
  // Document order matches portal paint order and also handles children mounting
  // before their parents in the same React commit.
  return [...modalLifecycle().surfaces].filter((surface) => surface.isConnected).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  ).at(-1);
}

function isolateBackground() {
  const { isolated } = modalLifecycle();
  for (const [element, inert] of isolated) {
    if (inert === null) element.removeAttribute("inert");
    else element.setAttribute("inert", inert);
  }
  isolated.clear();
  const active = topSurface();
  if (!active) return;
  // Keep only the ancestry of the active dialog interactive. This covers the
  // application, earlier portals, and sibling content in a nested inspector.
  function visit(parent: HTMLElement) {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || child === active) continue;
      if (child.contains(active!)) visit(child);
      else {
        isolated.set(child, child.getAttribute("inert"));
        child.setAttribute("inert", "");
      }
    }
  }
  visit(document.body);
}

function controlsWithin(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    const style = getComputedStyle(element);
    return element.tabIndex >= 0 &&
      (typeof element.checkVisibility !== "function" || element.checkVisibility()) &&
      !element.closest("[hidden], [inert]") && style.display !== "none" && style.visibility !== "hidden";
  });
}

/** One keyboard, inert-background and focus lifecycle for every modal surface. */
export function useDialogFocus(
  onClose?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    let lastFocus: HTMLElement = initialFocusRef?.current ?? dialog;
    const lifecycle = modalLifecycle(dialog.ownerDocument);
    lifecycle.surfaces.add(dialog);
    isolateBackground();
    if (!lifecycle.observer) {
      lifecycle.observer = new MutationObserver(isolateBackground);
      lifecycle.observer.observe(document.body, { childList: true, subtree: true });
    }
    if (topSurface() === dialog) lastFocus.focus();

    function onFocusIn(event: FocusEvent) {
      if (topSurface() !== dialog) return;
      const target = event.target;
      if (target instanceof HTMLElement && dialog!.contains(target) && !target.closest("[inert]")) lastFocus = target;
      else (lastFocus.isConnected && !lastFocus.closest("[inert]") ? lastFocus : dialog!).focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (topSurface() !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      } else if (event.key === "Tab") {
        const controls = controlsWithin(dialog!);
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog!.focus();
        } else if (active === dialog || !dialog!.contains(active) ||
          (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      const restoreFocus = document.activeElement === document.body || dialog.contains(document.activeElement);
      lifecycle.surfaces.delete(dialog);
      isolateBackground();
      if (!lifecycle.surfaces.size) {
        lifecycle.observer?.disconnect();
        lifecycle.observer = undefined;
      }
      // Preserve explicit post-decision focus (for example, a newly merged cast tile).
      if (trigger?.isConnected && !trigger.closest("[inert]") && restoreFocus) trigger.focus();
    };
  }, [initialFocusRef, returnFocusRef]);
  return ref;
}
