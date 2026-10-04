import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAppearance } from '../scripts/appearance-controls.mjs';

const page = { evaluate: callback => Promise.resolve(callback()) };
const key = 'meowdiobooks.appearance';

afterEach(() => { localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('visual review saved appearance', () => {
  it.each(['light', 'dark'])('reads a current %s override as an appearance', async appearance => {
    localStorage.setItem(key, JSON.stringify({ appearance, expiresAt: Date.now() + 60_000 }));
    expect(await readAppearance(page)).toBe(appearance);
  });
  it.each([null, 'dark', 'not JSON', JSON.stringify({ appearance: 'purple', expiresAt: 0 })])('ignores absent, legacy or invalid records: %s', async value => {
    if (value !== null) localStorage.setItem(key, value);
    expect(await readAppearance(page)).toBe('system');
  });
  it('returns to system at expiry and rejects an excessive deadline', async () => {
    vi.useFakeTimers();
    for (const deadline of [Date.now(), Date.now() - 1, Date.now() + 12 * 60 * 60 * 1000 + 1]) {
      localStorage.setItem(key, JSON.stringify({ appearance: 'dark', expiresAt: deadline }));
      expect(await readAppearance(page)).toBe('system');
    }
  });
  it('handles unavailable storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(await readAppearance(page)).toBe('system');
  });
});
