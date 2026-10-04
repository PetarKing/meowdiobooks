import type { ProductView } from './navigation';

/** Browser hints only; all book state and candidates are reloaded from the gateway. */
export interface WorkflowLocation {
  view: ProductView;
  home: boolean;
  bookId?: string;
  stepId?: string;
}

export function workflowStorageKey(name: 'location' | 'activeJob', namespace?: string) {
  const key = name === 'location' ? 'meowdiobooks.workflowLocation' : 'meowdiobooks.activeJob';
  return namespace === undefined ? key : `${key}:${encodeURIComponent(namespace)}`;
}

export function readWorkflowStorage(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeWorkflowStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Storage is optional; the live workflow must remain usable. */ }
}

export function readWorkflowLocation(key: string): WorkflowLocation | undefined {
  const raw = readWorkflowStorage(key);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as WorkflowLocation;
    if (!value || !['create', 'library'].includes(value.view) || typeof value.home !== 'boolean'
      || (value.bookId !== undefined && (typeof value.bookId !== 'string' || !value.bookId))
      || (value.stepId !== undefined && typeof value.stepId !== 'string')) return undefined;
    return value;
  } catch { return undefined; }
}

/** Hosts that reload after a deferred command can record its destination without key knowledge. */
export function persistWorkflowReturn(
  bookId: string,
  stepId: string,
  options: { namespace?: string; activeJobId?: string } = {},
) {
  writeWorkflowStorage(workflowStorageKey('location', options.namespace), JSON.stringify({
    view: 'create', home: false, bookId, stepId,
  } satisfies WorkflowLocation));
  if (options.activeJobId) writeWorkflowStorage(workflowStorageKey('activeJob', options.namespace), options.activeJobId);
}
