/** Synthetic gateway evidence; never reads books or calls a live backend. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from 'playwright';

const [phase = 'after', out = '/tmp/meow-book-resume', origin = 'http://127.0.0.1:5173'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = { phase, browser: browser.version(), os: `${os.type()} ${os.release()} ${os.arch()}`, command: process.argv.join(' '), cases: [] };
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
import '/src/i18n.ts';
import '/src/styles/product.css';
import { createFixtureGateway } from '/design-kit/gatewayFixture.ts';
const gateway = createFixtureGateway('dialogue-accepted');
const snapshot = await gateway.getBookSnapshot('kit-book');
snapshot.book.completedStages = ['import', 'extract', 'dialogue'];
snapshot.activeArtifacts = { extraction: 'e1', dialogue: 'd1' };
snapshot.cast = undefined; snapshot.recordingScript = undefined; snapshot.generatedChapters = [];
gateway.getBookSnapshot = async () => structuredClone(snapshot);
gateway.listBooks = async () => {
  const response = await fetch('/verification/books');
  if (!response.ok) throw new Error('Synthetic temporary outage');
  return response.json();
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, {}, React.createElement(App, { gateway })));
</script></body></html>`;

try {
  for (const locale of ['en', 'zh-CN']) for (const width of [320, 390, 749, 750, 751, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 900 }, locale,
      reducedMotion: 'reduce', ...(phase === 'after' && width === 390 && locale === 'en' ? { recordVideo: { dir: out } } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    let fail = false, delay = 0;
    await page.route(url => ['/', '/resume.html'].includes(url.pathname), route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
    await page.route('**/verification/books', async route => {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'kit-book', title: 'A saved book', source_name: null, source_kind: 'pdf', page_count: 120 },
      ]) });
    });
    await Promise.all([page.waitForResponse('**/verification/books'), page.goto(`${origin}/resume.html`)]);
    await page.locator('.quick-import').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (phase === 'before') {
      assert.equal(await page.locator('.recent-book-open').count(), 0);
    } else {
      await page.locator('.recent-book-open').waitFor();
    }
    await page.screenshot({ path: `${out}/${phase}-${locale}-${width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (phase === 'after') {
      const open = page.locator('.recent-book-open');
      for (let tab = 0; tab < 20 && !(await open.evaluate(el => el === document.activeElement)); tab++) await page.keyboard.press('Tab');
      assert(await open.evaluate(el => el === document.activeElement));
      assert(await open.evaluate(el => el.matches(':focus-visible')));
      assert((await open.boundingBox()).height >= 44);
      await page.keyboard.press('Enter');
      await page.locator('.wizard-steps, nav[aria-label="Wizard stages"], nav[aria-label="制作流程"]').first().waitFor();
      await page.reload();
      await page.locator('.step-eyebrow').filter({ hasText: locale === 'en' ? 'Step 3 · Review' : '第 3 步 · 审核' }).waitFor();
      await page.locator('.brand').click();
      await open.waitFor();
      fail = true;
      await page.reload();
      await page.getByRole('alert').waitFor();
      assert((await page.getByRole('alert').locator('p').boundingBox()).width >= 180);
      await page.screenshot({ path: `${out}/error-${locale}-${width}.png`, fullPage: true });
      fail = false; delay = 600;
      await page.getByRole('button', { name: locale === 'en' ? 'Try again' : '重试', exact: true }).click();
      await page.getByRole('status').waitFor();
      await open.waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    report.cases.push({ locale, width, height: width === 320 ? 568 : 900, result: 'passed' });
    const video = page.video();
    await context.close();
    if (video) await video.saveAs(`${out}/resume-${locale}-${width}.webm`);
  }
} finally {
  await writeFile(`${out}/${phase}-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
