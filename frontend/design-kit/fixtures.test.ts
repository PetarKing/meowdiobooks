import { describe, expect, it } from 'vitest';
import { createFixtureGateway, scenarios, snapshotFor } from './fixtures';
import { castFor } from './castFixtures';
import { strongConfirmationLabelsForCast } from '../src/castIdentity';
import { buildReviewWarningDecisions } from '../src/reviewDecisions';
import { decisionsForCast } from '../src/workflow/cast';
import { sourcePageHeading, sourcePageLines } from './syntheticContent';

describe('synthetic review gateway', () => {
  it('shows every word from the displayed source page in the final transcript fixture', async () => {
    const gateway = createFixtureGateway('review-ocr-bulk');
    const preview = await gateway.previewReviewTranscript('kit-book', 'review-fixture', 7, []);
    const transcript = preview.spans.map(span => span.text).join(' ');
    expect(transcript).toBe([sourcePageHeading, ...sourcePageLines].join(' '));
    expect(decodeURIComponent(preview.imageUrl!)).toContain('SYNTHETIC SOURCE PREVIEW · 7');
    expect(preview.spans.every(span => span.sourceEnd - span.sourceStart === span.text.length)).toBe(true);
  });
  it('accepts grouped review decisions through the production decision builder', async () => {
    const gateway = createFixtureGateway('review');
    const before = await gateway.getBookSnapshot('kit-book');
    const job = await gateway.processStage('kit-book', 'review', {});
    const revision = String(job.result!.revision);
    const candidate = await gateway.getStageCandidate('kit-book', 'review', revision);
    const warnings = candidate.warnings!;
    const choices = Object.fromEntries(warnings.flatMap(warning => [[warning.id, 'keep'], ...warning.occurrences.map(row => [row.id, 'keep'])])) as Record<string, 'keep'>;
    const decisions = await buildReviewWarningDecisions('kit-book', revision, warnings, choices, gateway.previewReviewBulk);
    expect(decisions.flatMap(row => row.occurrenceIds)).toEqual(warnings.flatMap(warning => warning.occurrences.map(row => row.id)));
    expect(decisions[0].occurrenceIds).toHaveLength(8);
    expect(decisions[0].previewToken).toBeTruthy();
    expect((await gateway.getBookSnapshot('kit-book')).book.completedStages).toEqual(before.book.completedStages);
    await gateway.acceptStage('kit-book', 'review', revision, decisions);
    const accepted = await gateway.getBookSnapshot('kit-book');
    expect(accepted.book.completedStages).toContain('review');
    expect(accepted.activeArtifacts.review).toBe(revision);
    await expect(gateway.previewReviewBulk('kit-book', revision, 'missing-occurrence', 'keep')).rejects.toThrow();
  });
  it('appends auditions chronologically without mutating earlier candidates or the accepted snapshot', async () => {
    const gateway = createFixtureGateway('cast-accepted');
    const accepted = await gateway.getBookSnapshot('kit-book');
    const characterId = accepted.cast!.identities![0].characterId;
    const settings = { characterId, proposalRevision: accepted.cast!.revision };
    const first = await gateway.processStage('kit-book', 'cast', settings);
    const draft = await gateway.getStageCandidate('kit-book', 'cast', first.result!.revision!);
    const voice = draft.identities!.find(row => row.characterId === characterId)!;
    const earlier = accepted.cast!.identities![0].voiceCandidates!;
    expect(earlier).toHaveLength(4);
    expect(earlier[0].source).toBe("previous-book");
    expect(voice.voiceCandidates).toHaveLength(earlier.length + 1);
    expect(voice.voiceCandidates!.slice(0, earlier.length)).toEqual(earlier);
    expect(voice.voicePreviewRevision).not.toBe(accepted.cast!.identities![0].voicePreviewRevision);
    expect(voice.voiceAccepted).toBe(false);
    expect(draft.narrator).toEqual(accepted.cast!.narrator);
    expect((await gateway.getBookSnapshot('kit-book')).cast).toEqual(accepted.cast);
    const second = await gateway.processStage('kit-book', 'cast', settings);
    const next = await gateway.getStageCandidate('kit-book', 'cast', second.result!.revision!);
    expect(next.identities![0].voiceCandidates).toHaveLength(earlier.length + 2);
    expect(next.identities![0].voiceCandidates!.slice(0, -1)).toEqual(voice.voiceCandidates);
    expect(next.identities![0].voicePreviewRevision).not.toBe(voice.voicePreviewRevision);
  });
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
  it('returns to identity review when the preview reclassifies source labels', async () => {
    const gateway = createFixtureGateway('cast-accepted');
    const accepted = await gateway.getBookSnapshot('kit-book');
    const job = await gateway.processStage('kit-book', 'cast', { forceReclassify: true });
    const revision = job.result?.revision;
    expect(revision).toBe('cast-fixture-draft');
    const candidate = await gateway.getStageCandidate('kit-book', 'cast', revision!);
    expect(candidate.phase).toBe('identity-review');
    expect(candidate.identityDecisions).toBeUndefined();
    expect((await gateway.getBookSnapshot('kit-book')).cast).toEqual(accepted.cast);
  });
  it('exposes blocking, advisory, and ready cast examples without changing accepted data', () => {
    const cast = castFor('review-spectrum-identities');
    const blocking = strongConfirmationLabelsForCast(cast, decisionsForCast(cast));
    expect(blocking).toContain('Royal Chorus');
    expect(blocking).not.toContain('Queen of Hearts');
    expect(cast.proposals.find(row => row.label === 'Queen of Hearts')?.reviewRequired).toBe(true);
    expect(cast.proposals.find(row => row.label === 'Alice')?.reviewRequired).toBe(false);
    const voices = castFor('missing-audition');
    expect(voices.identities?.find(row => row.name === 'Alice')?.voiceCandidates).toEqual([]);
    expect(voices.identities?.some(row => row.voiceAccepted)).toBe(true);
    expect(voices.identities?.some(row => !row.voiceAccepted && Boolean(row.voicePreviewRevision))).toBe(true);
  });
});
