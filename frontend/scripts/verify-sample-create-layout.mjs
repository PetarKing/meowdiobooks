/** Render the sample-based New Voice form without an extra enclosing frame. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/studio.html';
const out = process.argv[3] ?? '/private/tmp/meow-sample-create-layout';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    await page.getByRole('combobox', { name: 'Preview' }).selectOption('cast-inspector');
    const dialog = page.getByRole('dialog', { name: 'Alice voice' });
    await dialog.getByRole('button', { name: 'Create a new audition' }).click();
    await dialog.getByRole('radio', { name: /Clone from a sample/ }).click();
    const form = dialog.locator('.voice-sample-panel');
    await form.waitFor();
    const geometry = await form.evaluate(element => {
      const style = getComputedStyle(element);
      const source = element.parentElement.querySelector('.voice-source-choices');
      return {
        border: style.borderTopWidth,
        padding: style.paddingLeft,
        background: style.backgroundImage,
        left: element.getBoundingClientRect().left,
        sourceLeft: source.getBoundingClientRect().left,
      };
    });
    assert.equal(geometry.border, '0px');
    assert.equal(geometry.padding, '0px');
    assert.equal(geometry.background, 'none');
    assert(Math.abs(geometry.left - geometry.sourceLeft) <= 1);
    assert(await form.getByRole('button', { name: 'Create sampled audition →' }).isVisible());
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => (await window.axe.run('.voice-inspector')).violations.map(row => row.id));
    assert.deepEqual(violations, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/sample-${width}-${appearance}.png` });
    results.push({ width, appearance, geometry, overflow, violations, errors });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
