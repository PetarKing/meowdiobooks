import { chooseAppearance, readAppearance } from './appearance-controls.mjs';
/** Render the safe sanctuary preview and verify its real import controls. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/meowdiobooks-preview-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390, 320]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: width > 750 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue(); apiRequests.push(route.request().url()); return route.abort(); });
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    await page.waitForFunction(a => document.querySelector('.app-shell')?.dataset.appearance === a, appearance);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    assert(await page.locator('.sanctuary-art img').isVisible(), 'Cat sanctuary remains visible on phone');
    assert.equal(await page.locator('.sound-field canvas').count(), 0, 'Static art must not allocate a decorative GPU scene');
    assert(await page.locator('.quick-upload').isVisible());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `Document overflow: ${overflow}`);
    await page.screenshot({ path: `${out}/home-${width}-${appearance}.png`, fullPage: true });
    await page.locator('.quick-upload input').setInputFiles({ name: 'sanctuary-sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic control check') });
    await page.getByRole('button', { name: 'Import PDF' }).waitFor();
    assert.match(await page.locator('.file-receipt').innerText(), /sanctuary-sample.pdf/);
    await page.getByRole('button', { name: 'Choose another', exact: true }).click();
    assert(await page.locator('.quick-upload').isVisible());
    await page.reload();
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    assert.equal(await readAppearance(page), appearance, 'Appearance persists after reload');
    assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
    results.push({ width, appearance, overflow, artwork: 'visible and decoded', importFileReceipt: 'passed', changeFile: 'passed', persistedAppearance: 'passed', errors, apiRequests });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/preview.json`, JSON.stringify({ url, executedAt: new Date().toISOString(), scope: 'Synthetic preview presentation and control wiring; no real backend PDF parsing or audio generation.', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
