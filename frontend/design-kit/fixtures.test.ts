import { describe, expect, it } from 'vitest';
import { createFixtureGateway, scenarios, snapshotFor } from './fixtures';

describe('synthetic review gateway', () => {
  it('keeps mutations in one fixture instance and exports synthetic metadata only', async () => {
    const first = createFixtureGateway('generate');
    const other = createFixtureGateway('generate');
    await first.processStage('kit-book', 'generate', { chapterIds: ['chapter-4'] });
    const snapshot = await first.getBookSnapshot('kit-book');
    expect(snapshot.generatedChapters.find(c => c.chapterId === 'chapter-4')?.audioUrl).toMatch(/^data:audio\/wav/);
    const exported = await first.createAudioExport!('kit-book', [{chapterId:'chapter-4', revision:'chapter-4-simulated'}], {preset:'m4b-high',title:'Synthetic export'});
    expect(exported.sizeBytes).toBe(0);
    expect(await other.listLibrary()).toEqual([]);
    expect((await other.getBookSnapshot('kit-book')).generatedChapters.some(c=>c.chapterId==='chapter-4')).toBe(false);
  });
  it('keeps accepted artifacts consistent with every scenario', () => {
    for (const {id} of scenarios) {
      const snapshot = snapshotFor(id);
      expect(Boolean(snapshot.activeArtifacts.cast)).toBe(snapshot.book.completedStages.includes('cast'));
      expect(Boolean(snapshot.recordingScript)).toBe(snapshot.book.completedStages.includes('cast'));
      if (!snapshot.book.completedStages.includes('cast')) expect(snapshot.generatedChapters).toHaveLength(0);
    }
  });
});
