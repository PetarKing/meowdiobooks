/** Exercise manual state selection with a persisted Chinese preference. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/folio-preview-locales';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('meowdiobooks.locale', 'zh-CN'));
  const errors = [], apiRequests = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
    apiRequests.push(route.request().url()); return route.abort();
  });
  const settle = async () => {
    await page.waitForFunction(() => document.querySelector('.preview-controls [role="status"]')?.textContent !== 'Preparing screen…', undefined, { timeout: 10000 });
    assert.equal(await page.locator('.preview-controls [role="status"]').innerText(), 'Synthetic data · safe to explore');
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  };
  await page.goto(url); await settle();
  await page.reload(); await settle();
  const preview = page.getByRole('combobox', { name: 'Preview', exact: true });
  const scenarios = await preview.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
  for (const scenario of scenarios) {
    await preview.selectOption(scenario);
    try {
      await settle();
      results.push({ scenario, persistedLocale: 'zh-CN', passed: true });
    } catch (error) {
      await page.screenshot({ path: `${out}/${scenario}-failed.png` });
      await writeFile(`${out}/failure.json`, JSON.stringify({ scenario, error: String(error), previewError: await page.locator('.preview-error').allTextContents() }, null, 2));
      throw error;
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ url, generatedAt: new Date().toISOString(), reload: 'passed', results, errors, apiRequests }, null, 2));
  console.log(`${results.length} states entered with persisted Chinese locale; reload passed, zero API calls or runtime errors`);
} finally { await browser.close(); }
