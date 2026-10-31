/** One document-owned lifecycle across independently bundled App and /ui entries.
 * Keep the versioned state shape compatible across copies of this source package.
 */
const lifecycleKey: unique symbol = Symbol.for("meowdiobooks.modal-lifecycle.v1");

interface ModalLifecycle {
  scrollLocks: Set<symbol>;
  restoreScroll?: () => void;
  surfaces: Set<HTMLElement>;
  isolated: Map<HTMLElement, string | null>;
  observer?: MutationObserver;
}

type ModalDocument = Document & { [lifecycleKey]?: ModalLifecycle };

export function modalLifecycle(owner: Document = document): ModalLifecycle {
  const target = owner as ModalDocument;
  return target[lifecycleKey] ??= {
    scrollLocks: new Set(),
    surfaces: new Set(),
    isolated: new Map(),
  };
}
