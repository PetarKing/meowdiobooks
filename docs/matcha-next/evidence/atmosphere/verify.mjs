import assert from 'node:assert/strict';
import { chromium } from '../../../../frontend/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const directory = fileURLToPath(new URL('.', import.meta.url));
const base = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const reducedMotion of ['reduce', 'no-preference']) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme, reducedMotion });
    const errors = [];
    const apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (new URL(route.request().url()).pathname.startsWith('/api/')) { apiRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${base}?appearance=${theme}`);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Preview', exact: true }).selectOption('review-intro');
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    const state = await page.locator('.workspace:not(.home-workspace) > main').evaluate(async main => {
      await document.fonts.ready;
      const style = getComputedStyle(main);
      const source = style.backgroundImage.match(/url\("?(.*?)"?\)/)?.[1]?.replace(/"$/, '');
      const asset = new Image(); asset.src = source ?? ''; await asset.decode();
      return { backgroundImage: style.backgroundImage, animationName: style.animationName, assetSize: [asset.naturalWidth, asset.naturalHeight], documentOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.match(state.backgroundImage, /sanctuary-canopy/);
    assert.deepEqual(state.assetSize, [1536, 1024]);
    assert.equal(state.documentOverflow, 0);
    assert.equal(state.animationName === 'none', reducedMotion === 'reduce');
    const isolated = await page.evaluate(() => {
      const root = document.querySelector('.app-shell');
      const main = document.querySelector('.workspace:not(.home-workspace) > main');
      root.dataset.presentationPalette = 'custom';
      const background = getComputedStyle(main).backgroundImage;
      delete root.dataset.presentationPalette;
      return background;
    });
    assert.doesNotMatch(isolated, /sanctuary-canopy/, 'Branded art must stay out of custom semantic palettes');
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    if (reducedMotion === 'reduce') await page.screenshot({ path: `${directory}/review-intro-${width}-${theme}.png`, fullPage: true });
    results.push({ width, theme, reducedMotion, ...state, customPaletteBackground: isolated, errors, apiRequests });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${directory}/report.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, results }, null, 2)}\n`);
console.log(JSON.stringify({ cases: results.length, assetDecoded: true, reducedMotionHonored: true, overflow: 0, runtimeErrors: 0, apiRequests: 0 }));
