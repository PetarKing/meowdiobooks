import { chooseAppearance, readAppearance } from './appearance-controls.mjs';
/** Synthetic 200% text enlargement. Not browser zoom or a WCAG conformance test. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/folio-text-enlargement';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [], errors = [], apiRequests = [];
try {
  for (const theme of ['light', 'dark']) for (const scenario of ['home', 'review', 'cast-inspector', 'generate-long-book']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.clear());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ theme, scenario, message: error.message }));
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(url);
    await page.locator('.preview-controls select:not([disabled])').waitFor();
    await chooseAppearance(page, theme);
    await page.locator('.preview-controls select').selectOption(scenario);
    await page.waitForTimeout(100);
    await page.waitForFunction(() => document.querySelector('.preview-controls [role="status"]')?.textContent === 'Synthetic data · safe to explore');
    if (scenario === 'cast-inspector') await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(500);
    const enlargement = await page.evaluate(() => {
      // Snapshot every size before writing, so inherited sizes are not multiplied repeatedly.
      const snapshot = [...document.querySelectorAll('*')].filter(element => element instanceof HTMLElement).map(element => ({ element, font: parseFloat(getComputedStyle(element).fontSize) }));
      window.__textEnlargementSnapshot = snapshot;
      for (const { element, font } of snapshot) element.style.fontSize = `${font * 2}px`;
      return { elements: snapshot.length, factor: 2, method: 'computed fontSize snapshot, inline fontSize doubled; geometry and line-height rules untouched' };
    });
    const measure = () => page.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const visible = element => { const s = getComputedStyle(element), r = element.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
      const fontIntegrity = window.__textEnlargementSnapshot.map(({ element, font }) => ({ connected: element.isConnected, original: font, current: parseFloat(getComputedStyle(element).fontSize), tag: element.tagName, class: element.className })).filter(row => !row.connected || Math.abs(row.current - row.original * 2) > .1);
      const scope = document.querySelector('[role="dialog"]') ?? document.querySelector('[data-presentation-root]');
      const textRuns = [...scope.querySelectorAll('.voice-trait-column label,.chapter-estimates dt,.chapter-estimates dd,.rail nav strong')].flatMap(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).map(node => { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); return { text: node.textContent.trim(), parentClass: element.className, box: {left:r.left,right:r.right,top:r.top,bottom:r.bottom}, parentBox:box(element) }; }));
      const controls = [...scope.querySelectorAll('button,select,input,textarea')].filter(visible).map(element => ({ tag: element.tagName, name: element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 100), box: box(element), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
      const clipped = [...scope.querySelectorAll('*')].filter(element => element instanceof HTMLElement && visible(element)).filter(element => { const s = getComputedStyle(element); return (['hidden','clip'].includes(s.overflowX) && element.scrollWidth > element.clientWidth + 1) || (['hidden','clip'].includes(s.overflowY) && element.scrollHeight > element.clientHeight + 1) || s.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1; }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.trim().slice(0, 160), box: box(element), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY }));
      return { fontIntegrity, textRuns, lastTrack: document.querySelector('.chapter-card:last-child') ? box(document.querySelector('.chapter-card:last-child')) : null, generationAction: document.querySelector('.generation-selection') ? box(document.querySelector('.generation-selection')) : null, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, controls, clipped };
    });
    await page.waitForTimeout(250);
    const initial = await measure();
    if (scenario === 'cast-inspector') await page.locator('.cast-inspector').evaluate(element => element.scrollTop = element.scrollHeight);
    if (scenario === 'generate-long-book') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const captured = await measure();
    assert.equal(captured.fontIntegrity.length, 0, 'Every snapshot element must retain doubled fontSize before capture');
    // Exactly eight desktop screenshots: one per state/theme. Generate captures its final action; inspector captures tuning.
    await page.screenshot({ path: `${out}/${scenario}-${theme}.png`, fullPage: scenario === 'home' || scenario === 'review' });
    reports.push({ theme, scenario, enlargement, initial, captured });
    await context.close();
  }
  assert.deepEqual(apiRequests, [], 'Synthetic review must not call production APIs');
  await writeFile(`${out}/report.json`, JSON.stringify({ url, generatedAt: new Date().toISOString(), syntheticTextEnlargement: true, nativeZoom: false, screenshots: 8, errors, apiRequests, reports }, null, 2));
  console.log(JSON.stringify({ screenshots: 8, errors, apiRequests, rows: reports.map(row => ({ theme: row.theme, scenario: row.scenario, width: row.initial.documentWidth, clippingCandidates: row.initial.clipped.length })) }));
} finally { await browser.close(); }
