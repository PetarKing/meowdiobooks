/** Synthetic worker/browser lifecycle evidence; never calls live providers or user storage. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [out = '/tmp/meow-workflow-return', origin = 'http://127.0.0.1:5188'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = { browser: browser.version(), command: process.argv.join(' '), scenarios: [] };
const html = `<!doctype html><html><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import App from '/src/App.tsx';
import { persistWorkflowReturn } from '/src/workflow/navigation.ts';
import '/src/i18n.ts';
import '/src/styles/product.css';
import { createFixtureGateway } from '/design-kit/gatewayFixture.ts';
const namespace = 'synthetic-account';
const gateway = createFixtureGateway('dialogue-accepted');
const snapshot = await gateway.getBookSnapshot('kit-book');
snapshot.book.completedStages = ['import', 'extract'];
snapshot.activeArtifacts = { extraction: 'e1' };
snapshot.cast = undefined; snapshot.recordingScript = undefined; snapshot.generatedChapters = [];
const state = async () => {
  const response = await fetch('/verification/state');
  if (!response.ok) throw Object.assign(new Error('Synthetic snapshot outage'), { status: response.status });
  return response.json();
};
gateway.getBookSnapshot = async () => {
  const saved = structuredClone(snapshot);
  if ((await state()).done) saved.pendingCandidates = { dialogue: { revision: 'dialogue-fixture-draft', status: 'candidate' } };
  return saved;
};
gateway.getJob = async id => {
  const worker = await state();
  return { id, kind: 'v2:dialogue', status: worker.done ? 'succeeded' : 'running', progress: worker.done ? 100 : 41,
    payload: { book_id: 'kit-book' }, message: 'Checking dialogue speakers' };
};
window.__commands = 0;
gateway.processStage = async () => { window.__commands++; throw new Error('Provider must not rerun on return'); };
gateway.getRepresentativePages = async () => { throw new Error('Later-stage return must not request PDF previews'); };
if (!localStorage.getItem('synthetic.seeded')) {
  localStorage.setItem('synthetic.seeded', 'true');
  persistWorkflowReturn('kit-book', 'dialogue', { namespace, activeJobId: 'dialogue-running' });
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, {}, React.createElement(App, { gateway, workflowPersistenceNamespace: namespace })));
</script></body></html>`;

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', recordVideo: { dir: out } });
    const page = await context.newPage();
    const errors = [];
    let done = false, outage = false;
    page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.route(url => ['/', '/return.html', '/library'].includes(url.pathname), route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
    await page.route('**/verification/state', route => route.fulfill({ status: outage ? 503 : 200,
      contentType: 'application/json', body: JSON.stringify({ done }) }));
    await page.goto(`${origin}/return.html`);
    await page.locator('.book-mini').waitFor({ state: 'attached', timeout: 10000 }).catch(async error => { await page.screenshot({ path: `${out}/debug-${width}.png`, fullPage: true }); console.error(await page.locator('body').innerText()); throw error; });
    await page.getByRole('progressbar', { name: 'Processing progress' }).waitFor();
    await page.screenshot({ path: `${out}/running-${width}.png`, fullPage: true });
    const session = await context.newCDPSession(page);
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    done = true;
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.getByText('Your transcript is ready', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('meowdiobooks.activeJob:synthetic-account')), null);
    assert.equal(await page.evaluate(() => window.__commands), 0);
    await page.reload();
    await page.getByText('Your transcript is ready', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Dialogue Draft ready' }).getAttribute('aria-current'), 'step');
    await page.screenshot({ path: `${out}/finished-after-reload-${width}.png`, fullPage: true });
    outage = true;
    await page.reload();
    await page.getByRole('alert').waitFor();
    assert((await page.evaluate(() => localStorage.getItem('meowdiobooks.workflowLocation:synthetic-account'))).includes('kit-book'));
    outage = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('Your transcript is ready', { exact: true }).waitFor();
    await page.locator('.brand').click();
    await page.reload();
    await page.locator('.recent-book-open').waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Wizard stages' }).count(), 0);
    await page.locator('.recent-book-open').click();
    await page.getByText('Your transcript is ready', { exact: true }).waitFor();
    if (width < 750) await page.goto(`${origin}/library`);
    else await page.locator('.product-tabs button').last().click();
    await page.reload();
    await page.getByRole('heading', { name: 'Your audiobooks', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__commands), 0);
    assert.deepEqual(errors, []);
    report.scenarios.push({ width, result: 'passed', cases: ['running-book-visible', 'CDP-frozen-worker-completes', 'pending-dialogue-after-marker-cleared-reload', 'snapshot-outage-retry', 'explicit-home-reload', 'explicit-library-reload', 'no-provider-rerun', 'no-extraction-preview'] });
    const video = page.video();
    await context.close();
    await video.saveAs(`${out}/workflow-return-${width}.webm`);
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
