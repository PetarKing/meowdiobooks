import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWorkflowReturn } from './navigation';
import { readWorkflowLocation, readWorkflowStorage, workflowStorageKey, writeWorkflowStorage } from './workflowLocation';

describe('optional workflow return storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('records the scoped book, stable step, and deferred job without storing book data', () => {
    persistWorkflowReturn('book-one', 'dialogue', { namespace: 'account/a', activeJobId: 'job-one' });
    expect(readWorkflowLocation(workflowStorageKey('location', 'account/a'))).toEqual({
      view: 'create', home: false, bookId: 'book-one', stepId: 'dialogue',
    });
    expect(readWorkflowStorage(workflowStorageKey('activeJob', 'account/a'))).toBe('job-one');
    expect(readWorkflowStorage(workflowStorageKey('activeJob', 'account-b'))).toBeNull();
    expect(readWorkflowStorage(workflowStorageKey('location'))).toBeNull();
  });

  it.each(['{broken', 'null', '"value"', '{"view":"create","home":false,"bookId":34}', '{"view":"unknown","home":false}', '{"view":"create","home":false,"bookId":""}'])('ignores invalid saved location %s', (raw) => {
    localStorage.setItem('location', raw);
    expect(readWorkflowLocation('location')).toBeUndefined();
  });

  it('does not break a workflow when storage is unavailable or full', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(readWorkflowStorage('key')).toBeNull();
    expect(readWorkflowLocation('key')).toBeUndefined();
    expect(() => persistWorkflowReturn('book', 'dialogue', { activeJobId: 'job' })).not.toThrow();
    expect(() => writeWorkflowStorage('key', null)).not.toThrow();
  });
});
