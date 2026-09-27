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
  const preference = page.getByRole('combobox', { name: 'Appearance', exact: true });
  async function observe(name, expected, screenshot = false) {
    const colors = expected === 'dark' ? { background: 'rgb(29, 38, 27)', text: 'rgb(240, 244, 230)' } : { background: 'rgb(241, 242, 232)', text: 'rgb(45, 56, 37)' };
    // Attribute updates precede the finite color transition. Assert the settled
    // surface too, rather than recording an intermediate frame as final evidence.
    await page.waitForFunction(({ mode, background, text }) => {
      const root = document.querySelector('[data-presentation-root]');
      return root?.dataset.appearance === mode && getComputedStyle(root).backgroundColor === background && getComputedStyle(root).color === text;
    }, { mode: expected, ...colors });
    const result = await page.locator('[data-presentation-root]').evaluate(root => ({
      appearance: root.dataset.appearance,
      colorScheme: getComputedStyle(root).colorScheme,
      background: getComputedStyle(root).backgroundColor,
      text: getComputedStyle(root).color,
    }));
    assert.equal(result.colorScheme, expected);
    assert.equal(result.background, colors.background); assert.equal(result.text, colors.text);
    observations.push({ name, preference: await preference.inputValue(), ...result });
    if (screenshot) await page.screenshot({ path: `${out}/${name}.png` });
  }
  await preference.selectOption('system');
  await observe('system-light', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await observe('system-dark', 'dark', true);
  await preference.selectOption('light');
  await observe('explicit-light-on-dark-os', 'light', true);
  await page.emulateMedia({ colorScheme: 'light' });
  await observe('explicit-light-on-light-os', 'light');
  await preference.selectOption('dark');
  await observe('explicit-dark-on-light-os', 'dark');
  await page.reload();
  await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  await observe('explicit-dark-after-reload', 'dark');
  await preference.selectOption('system');
  await observe('system-resumed-light', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await observe('system-resumed-dark', 'dark');
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ base, source, generatedAt: new Date().toISOString(), method: 'Chromium emulated prefers-color-scheme changes; no host OS settings changed', observations, errors, apiRequests, passed: true }, null, 2));
  console.log('PASS: eight System/explicit preference transitions, reload, native color scheme; no API calls or runtime errors.');
} finally { await context.close(); await browser.close(); }
