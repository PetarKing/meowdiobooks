/** Exercise the local synthetic preview without a workflow gateway. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/meow-mobile-product-navigation';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390, 320]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Preview' }).selectOption('home-shelf');
    await chooseAppearance(page, appearance);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    const headerTabs = page.getByRole('navigation', { name: 'Product areas' });
    const homeLibrary = page.locator('.home-mobile-library');
    if (width <= 750) {
      assert.equal(await headerTabs.isVisible(), false, 'Mobile header tabs should be hidden');
      assert(await homeLibrary.isVisible(), 'Home must expose Library on mobile');
      await page.screenshot({ path: `${out}/home-${width}-${appearance}.png`, fullPage: true });
      await homeLibrary.click();
      assert(await page.getByText('Your audiobooks', { exact: true }).isVisible(), 'Home Library link should navigate');
      await page.getByRole('button', { name: 'Go to Home' }).click();
      assert(await homeLibrary.isVisible(), 'Brand should return to Home');
      await page.getByRole('combobox', { name: 'Preview' }).selectOption('cast-voice-review-states');
      await page.getByRole('heading', { name: 'Voices' }).waitFor();
      assert.equal(await headerTabs.isVisible(), false, 'Workflow still has a single mobile header row');
      await page.getByRole('button', { name: 'Go to Home' }).click();
      assert(await homeLibrary.isVisible(), 'Brand should return home from a workflow step');
    } else {
      assert(await headerTabs.isVisible(), 'Desktop header tabs should remain visible');
      assert.equal(await homeLibrary.isVisible(), false, 'Mobile home link should stay hidden on desktop');
      await headerTabs.getByRole('button', { name: /Library/ }).click();
      await page.getByRole('button', { name: 'Go to Home' }).click();
      assert(await page.getByRole('button', { name: 'Choose PDF' }).isVisible());
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${width}px overflow: ${overflow}`);
    assert.deepEqual(errors, []);
    results.push({ width, appearance, headerTabsVisible: width > 750, homeLibraryVisible: width <= 750, brandReturnsHome: true, overflow, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ url, scope: 'Synthetic local navigation; no backend operation.', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
