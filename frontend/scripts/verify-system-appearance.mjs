import { chooseAppearance, readAppearance } from './appearance-controls.mjs';
/** Exercise live OS-preference changes in an isolated synthetic preview context. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/folio-system-appearance';
const source = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), trackedChanges: execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim() };
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], apiRequests = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', route => {
  if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
  apiRequests.push(route.request().url()); return route.abort();
});
try {
  await page.goto(base);
  await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  async function observe(name, expected, screenshot = false) {
    // Resolve the semantic palette in the browser so a deliberate color change
    // does not make this appearance-transition check stale.
    await page.waitForFunction((mode) => {
      const root = document.querySelector('[data-presentation-root]');
      if (!root || root.dataset.appearance !== mode) return false;
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--folio-canvas)';
      probe.style.color = 'var(--folio-ink)';
      root.append(probe);
      const expectedBackground = getComputedStyle(probe).backgroundColor;
      const expectedText = getComputedStyle(probe).color;
      probe.remove();
      const current = getComputedStyle(root);
      return current.backgroundColor === expectedBackground && current.color === expectedText;
    }, expected);
    const result = await page.locator('[data-presentation-root]').evaluate(root => ({
      appearance: root.dataset.appearance,
      colorScheme: getComputedStyle(root).colorScheme,
      background: getComputedStyle(root).backgroundColor,
      text: getComputedStyle(root).color,
    }));
    assert.equal(result.colorScheme, expected);
    observations.push({ name, preference: await readAppearance(page), ...result });
    if (screenshot) await page.screenshot({ path: `${out}/${name}.png` });
  }
  await chooseAppearance(page, 'system');
  await observe('system-light', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await observe('system-dark', 'dark', true);
  assert.notEqual(observations[0].background, observations[1].background);
  assert.notEqual(observations[0].text, observations[1].text);
  await chooseAppearance(page, 'light');
  await observe('explicit-light-on-dark-os', 'light', true);
  await page.emulateMedia({ colorScheme: 'light' });
  await observe('explicit-light-on-light-os', 'light');
  await chooseAppearance(page, 'dark');
  await observe('explicit-dark-on-light-os', 'dark');
  await page.reload();
  await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  await observe('explicit-dark-after-reload', 'dark');
  await chooseAppearance(page, 'system');
  await observe('system-resumed-light', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await observe('system-resumed-dark', 'dark');
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ base, source, generatedAt: new Date().toISOString(), method: 'Chromium emulated prefers-color-scheme changes; no host OS settings changed', observations, errors, apiRequests, passed: true }, null, 2));
  console.log('PASS: eight System/explicit preference transitions, reload, native color scheme; no API calls or runtime errors.');
} finally { await context.close(); await browser.close(); }
