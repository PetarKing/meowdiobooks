import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../api/contracts';
import { readyChapterCount, remainingGenerationTime, type GenerationRun } from './generation';

const run: GenerationRun = {
  chapterIds: ['opening', 'preface', 'body'], estimatedAudioSeconds: 3600, startedAtMs: 0,
};
const running: Job = { id: 'generation', kind: 'v2:generate', status: 'running' };
afterEach(() => vi.useRealTimers());

describe('completed chapter progress', () => {
  it.each([0, 1, 2, 3])('shows %i rendered chapters from aggregate parallel progress', (completed) => {
    expect(readyChapterCount(run, { ...running, message: `Rendering chapters: ${completed} of 3 complete` }, 50)).toBe(completed);
  });

  it.each([
    'Rendering chapters: 1 of 2 complete',
    'Rendering chapters: 4 of 3 complete',
    'Rendering chapters: -1 of 3 complete',
    'Rendering chapters: 1.5 of 3 complete',
    'Rendering chapters: 9007199254740993 of 3 complete',
    'Rendering chapters: 1 of 3 complete; publishing',
    'Rendering chapters: one of three complete',
    'Generating chapter 2 of 3',
  ])('does not invent a completed count from %s', (message) => {
    expect(readyChapterCount(run, { ...running, message }, 50)).toBe(0);
  });

  it('preserves sequential-renderer progress in requested chapter order', () => {
    expect(readyChapterCount(run, { ...running, message: 'body: segment 1 of 20' }, 40)).toBe(2);
    expect(readyChapterCount(run, { ...running, message: 'opening: segment 1 of 2' }, 40)).toBe(0);
    expect(readyChapterCount(run, { ...running, message: 'unknown: segment 1 of 2' }, 40)).toBe(0);
  });

  it('preserves terminal progress and safely handles missing or queued runs', () => {
    expect(readyChapterCount(run, { ...running, status: 'succeeded' }, 100)).toBe(3);
    expect(readyChapterCount(run, running, 100)).toBe(3);
    expect(readyChapterCount(undefined, running, 100)).toBe(0);
    expect(readyChapterCount(run, undefined, 50)).toBe(0);
    expect(readyChapterCount(run, { ...running, status: 'queued', message: 'body: old progress' }, 20)).toBe(0);
  });
});

describe('generation time estimate', () => {
  it('separates queue waits from estimated processing time, including stale progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:10:00Z'));
    const queued: Job = { ...running, status: 'queued', started_at: '2026-01-01T10:00:00Z' };
    expect(remainingGenerationTime(run, queued, 20)).toBe('Waiting to start');
    expect(remainingGenerationTime(undefined, queued, 0)).toBe('Waiting to start');
    expect(remainingGenerationTime(run, { ...queued, status: 'running', message: 'Waiting for audio capacity (queue position 2)' }, 20)).toBe('Waiting for audio capacity');
  });

  it('keeps the measured remaining time rather than substituting a faster promise', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:10:00Z'));
    expect(remainingGenerationTime(run, { ...running, started_at: '2026-01-01T10:00:00Z' }, 20)).toBe('≈ 40 min');
    expect(remainingGenerationTime(run, running, 100)).toBe('Almost done');
  });

  it('retains host policy and historical estimates before enough progress is available', () => {
    const policy = { fallbackLowerMultiplier: 0.1, fallbackUpperMultiplier: 0.2 };
    expect(remainingGenerationTime(run, running, 1, policy)).toBe('≈ 6 min–12 min');
    expect(remainingGenerationTime({ ...run, historicalMultiplier: 0.5 }, running, 1, policy)).toBe('≈ 30 min–1 hr');
    expect(remainingGenerationTime(undefined, running, 1, policy)).toBe('Estimating…');
  });
});
