/** Reproduce final-review navigation on a 600-page book with unavailable previews. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5194';
const out = process.argv[3] ?? '/tmp/meowdiobooks-review-preview';
await mkdir(out, { recursive: true });
async function scrollPage(page, bottom) {
  await page.evaluate(async bottom => {
    scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, bottom);
}
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    for (const mode of ['pending', 'failed', 'image', 'transition']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : route.continue());
      await page.route('**/slow-original.png', () => {});
      await page.goto(url);
      await page.evaluate(async ({ mode, appearance }) => {
        const [{ default: React }, { default: ReactDOM }, { default: App }, { snapshotFor }, { createFixtureGateway }] = await Promise.all([
          import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
          import('/src/App.tsx'), import('/design-kit/snapshotFixture.ts'), import('/design-kit/gatewayFixture.ts'),
        ]);
        document.getElementById('root').style.display = 'none';
        const target = document.createElement('div'); document.body.append(target);
        const snapshot = snapshotFor('review');
        snapshot.book.pageCount = 600;
        snapshot.book.completedStages = ['import', 'extract', 'dialogue'];
        snapshot.activeArtifacts = { extraction: 'e1', dialogue: 'd1' };
        snapshot.pendingCandidates = { review: { revision: 'preview-proof', status: 'candidate' } };
        const gateway = createFixtureGateway('review');
        gateway.getBookSnapshot = async () => structuredClone(snapshot);
        gateway.getStageCandidate = async () => ({ revision: 'preview-proof', warnings: [], boundaryCandidates: [] });
        gateway.listBookJobs = async () => [];
        window.proof = { requests: [], accepted: [], signals: [] };
        gateway.previewReviewTranscript = async (...args) => {
          window.proof.requests.push(args.slice(0, 6)); window.proof.signals.push(args[6]);
          if (mode === 'pending') return new Promise(() => {});
          if (mode === 'transition') return new Promise(resolve => { window.proof.finishPreview = () => resolve({ page: args[2], pageCount: 600, imageUrl: '/slow-original.png', published: false, summary: { spoken: 1, dialogue: 0, excluded: 0 }, spans: [{ id: 's1', kind: 'narration', reader: 'Narrator', text: 'The text is available.', blockId: 'b', sourceStart: 0, sourceEnd: 22 }] }); });
          if (mode === 'failed') throw new Error('Synthetic preview failure');
          return { page: args[2], pageCount: 600, imageUrl: '/slow-original.png', published: false,
            summary: { spoken: 1, dialogue: 0, excluded: 0 }, spans: [{ id: `s${args[2]}`, kind: 'narration', reader: 'Narrator',
              text: 'The text is available before the original image.', blockId: 'b', sourceStart: 0, sourceEnd: 47 }] };
        };
        gateway.acceptStage = async (...args) => {
          window.proof.accepted.push(args); snapshot.book.completedStages.push('review');
          snapshot.activeArtifacts.review = 'review-accepted'; snapshot.pendingCandidates = {};
        };
        ReactDOM.createRoot(target).render(React.createElement(App, { gateway, appearance,
          initialWorkflowLocation: { bookId: snapshot.book.id, stepId: 'review' } }));
      }, { mode, appearance });
      await page.getByRole('button', { name: 'Review complete transcript →' }).click();
      await page.waitForFunction(() => window.proof.requests.length === 1);
      const accept = page.getByRole('button', { name: 'Accept review and continue →' });
      assert.equal(await accept.isEnabled(), true);
      const footerPosition = await accept.evaluate(node => getComputedStyle(node.closest('.transcript-final-action')).position);
      assert.equal(footerPosition, 'sticky');
      const actionBounds = await accept.boundingBox();
      assert.ok(actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= 901, 'Continue stays in the viewport');
      if (mode === 'pending') {
        await page.screenshot({ path: `${out}/viewport-top-${width}-${appearance}.png` });
        await scrollPage(page, true);
        const scrolledAction = await accept.boundingBox();
        assert.ok(scrolledAction.y >= 0 && scrolledAction.y + scrolledAction.height <= 901);
        await page.screenshot({ path: `${out}/viewport-bottom-${width}-${appearance}.png` });
        await scrollPage(page, false);
      }
      if (mode === 'pending' || mode === 'transition') {
        assert.equal(await page.locator('.review-preview-skeleton').count(), 2);
        const motion = await page.locator('.review-preview-skeleton .skeleton-line').first().evaluate(node => getComputedStyle(node, '::after').animationName);
        assert.equal(motion, 'none');
      }
      let geometry = null;
      if (mode === 'transition') {
        const desk = page.locator('.review-transcript-compare');
        const before = await desk.boundingBox();
        await page.screenshot({ path: `${out}/skeleton-${width}-${appearance}.png`, fullPage: true });
        await scrollPage(page, true);
        await page.screenshot({ path: `${out}/viewport-skeleton-bottom-${width}-${appearance}.png` });
        await scrollPage(page, false);
        await page.evaluate(() => window.proof.finishPreview());
        await page.getByRole('article', { name: 'Audiobook transcript page 1' }).waitFor();
        const after = await desk.boundingBox();
        geometry = { before, after };
        assert.deepEqual(after, before, 'Preview geometry stays fixed when skeleton becomes text');
        await scrollPage(page, true);
        await page.screenshot({ path: `${out}/viewport-loaded-bottom-${width}-${appearance}.png` });
        await scrollPage(page, false);
      }
      if (mode === 'failed') await page.getByRole('button', { name: 'Retry page preview' }).waitFor();
      if (mode === 'image') {
        await page.getByRole('article', { name: 'Audiobook transcript page 1' }).waitFor();
        await page.getByRole('slider', { name: 'Transcript preview page' }).fill('543');
        await page.getByRole('article', { name: 'Audiobook transcript page 543' }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.proof.requests.map(args => args[2])), [1, 543]);
      }
      assert.equal(await page.getByRole('alert').count(), 0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1);
      await accept.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/viewport-${mode}-${width}-${appearance}.png` });
      await page.screenshot({ path: `${out}/${mode}-${width}-${appearance}.png`, fullPage: true });
      await accept.click();
      await page.waitForFunction(() => window.proof.accepted.length === 1);
      await accept.waitFor({ state: 'detached' });
      const proof = await page.evaluate(() => ({ requests: window.proof.requests.map(args => args[2]),
        accepted: window.proof.accepted.length, allAborted: window.proof.signals.every(signal => signal.aborted) }));
      assert.equal(proof.allAborted, true); assert.deepEqual(errors, []);
      results.push({ width, appearance, mode, ...proof, geometry, overflow, errors });
      await page.close();
    }
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ scope: 'Chromium with synthetic 600-page book; pending/failed transcript and stalled original image; no provider calls', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
