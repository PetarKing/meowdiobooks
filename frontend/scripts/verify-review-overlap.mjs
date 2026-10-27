/** Verify Review preview failure and explicit recovery with synthetic data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5186';
const out = process.argv[3] ?? '/tmp/meowdiobooks-review-overlap';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 980 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : route.continue());
    await page.goto(url);
    await page.evaluate(async () => {
      const [{ default: React }, { default: ReactDOM }, { default: App }, { snapshotFor }, { createFixtureGateway }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/App.tsx'), import('/design-kit/snapshotFixture.ts'), import('/design-kit/gatewayFixture.ts'),
      ]);
      document.getElementById('root').style.display = 'none';
      const target = document.createElement('div');
      document.body.append(target);
      const snapshot = snapshotFor('review');
      snapshot.book.completedStages = ['import', 'extract', 'dialogue'];
      snapshot.activeArtifacts = { extraction: 'e1', dialogue: 'd1' };
      snapshot.pendingCandidates = { review: { revision: 'review-proof', status: 'candidate' } };
      const candidate = { revision: 'review-proof', warnings: [
        { id: 'notes', kind: 'footnote', availableActions: ['keep', 'exclude'], readerState: 'narrator', occurrences: [{ id: 'note-1', source: '[4] A scholar stud-', page: 27 }] },
        { id: 'corrections', kind: 'ai-cleanup', decisionScope: 'occurrence', availableActions: ['keep', 'repair'], occurrences: [{ id: 'repair-1', source: 'stud-\n ied', replacement: 'studied', proposalStatus: 'proposed', availableActions: ['keep', 'repair'], page: 27 }] },
      ], boundaryCandidates: [{ id: 'chapter-1', page: 1, source: 'Chapter 1', reason: 'Standalone heading' }] };
      const gateway = createFixtureGateway('review');
      gateway.getBookSnapshot = async () => structuredClone(snapshot);
      gateway.getStageCandidate = async () => structuredClone(candidate);
      gateway.listBookJobs = async () => [];
      let previewRequests = 0;
      window.proof = { requests: [], accepted: [] };
      gateway.previewReviewTranscript = async (...args) => {
        window.proof.requests.push(args);
        if (++previewRequests === 1) throw new Error('Cleanup repair crosses another review decision; keep it or revise that decision');
        return { page: 1, pageCount: 120, published: false, summary: { spoken: 1, dialogue: 0, excluded: 0 }, spans: [{ id: 's', kind: 'narration', reader: 'Narrator', text: 'Story resumes.', blockId: 'b', sourceStart: 0, sourceEnd: 14 }] };
      };
      gateway.acceptStage = async (...args) => { window.proof.accepted.push(args); };
      ReactDOM.createRoot(target).render(React.createElement(App, { gateway, initialWorkflowLocation: { bookId: snapshot.book.id, stepId: 'review' } }));
    });
    await page.getByRole('button', { name: /Start a new chapter/ }).click();
    await page.getByRole('button', { name: /^Leave out/ }).click();
    await page.getByRole('button', { name: /^Apply correction/ }).click();
    await page.getByRole('button', { name: 'Review complete transcript →' }).click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /A correction overlaps another review choice/);
    assert.equal(await page.getByText('No spoken text on this page').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Accept review and continue →' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Apply correction/ }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${out}/overlap-recovery-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: /^Keep original text/ }).click();
    await page.getByRole('button', { name: 'Review complete transcript →' }).click();
    await page.getByRole('article', { name: 'Audiobook transcript page 1' }).waitFor();
    assert.equal(await alert.count(), 0);
    const proof = await page.evaluate(() => window.proof);
    assert.deepEqual(proof.requests[1].slice(3), [[{ warningId: 'notes', action: 'exclude' }], [{ occurrenceId: 'repair-1', action: 'keep' }]]);
    assert.deepEqual(proof.accepted, []);
    await page.screenshot({ path: `${out}/overlap-recovered-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    results.push({ width, failureReturnedToDecisions: true, actionableMessage: true, choicePreserved: true, retryPreviewSucceeded: true, automaticAcceptance: false, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ scope: 'Real Chromium UI with synthetic in-memory gateway; no live customer changes or provider calls', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
