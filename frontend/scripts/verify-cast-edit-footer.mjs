/** Inspect the exact populated Cast editing footer in the local workshop. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/studio.html';
const out = process.argv[3] ?? '/private/tmp/cast-edit-footer';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const measureFooter = footer => footer.evaluate(element => {
  const style = getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  const status = element.querySelector('span')?.getBoundingClientRect();
  const secondary = element.querySelector('.phase-action-buttons > .ghost');
  const secondaryStyle = secondary ? getComputedStyle(secondary) : null;
  return {
    borderTop: style.borderTopWidth, borderLeft: style.borderLeftWidth,
    borderRight: style.borderRightWidth, borderBottom: style.borderBottomWidth,
    radius: style.borderRadius, background: style.backgroundColor,
    statusIndent: status ? Math.round(status.left - bounds.left) : null,
    secondaryBorder: secondaryStyle?.borderWidth,
    secondaryBackground: secondaryStyle?.backgroundColor,
    secondaryHeight: secondary?.getBoundingClientRect().height,
  };
});
const assertOpenInset = metrics => {
  assert.equal(metrics.borderTop, '1px');
  assert.equal(metrics.borderLeft, '0px');
  assert.equal(metrics.borderRight, '0px');
  assert.equal(metrics.borderBottom, '0px');
  assert.equal(metrics.radius, '0px');
  assert(metrics.statusIndent >= 16 && metrics.statusIndent <= 24, `Status inset ${metrics.statusIndent}`);
};
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('combobox', { name: 'Preview' }).selectOption('cast-accepted');
    await chooseAppearance(page, appearance);
    await page.getByRole('button', { name: /Change settings/ }).click();
    await page.getByRole('dialog', { name: 'Change the cast?' }).getByRole('button', { name: /Change cast/ }).click();
    const voiceFooter = page.locator('.cast-voice-final-action');
    await voiceFooter.waitFor();
    const voiceMetrics = await measureFooter(voiceFooter);
    assertOpenInset(voiceMetrics);
    if (width === 390) { assert.equal(voiceMetrics.secondaryBorder, '0px'); assert(voiceMetrics.secondaryHeight >= 44); }
    await voiceFooter.screenshot({ path: `${out}/voices-footer-${width}-${appearance}.png` });
    await page.getByRole('button', { name: /Edit cast/ }).click();
    await page.getByRole('heading', { name: 'Review the cast.' }).waitFor();
    const footer = page.locator('.cast-final-action');
    await footer.getByText('No cast changes to apply').waitFor();
    const metrics = await measureFooter(footer);
    assertOpenInset(metrics);
    if (width === 390) { assert.equal(metrics.secondaryBorder, '0px'); assert(metrics.secondaryHeight >= 44); }
    assert(await footer.getByRole('button', { name: 'Cancel cast edits' }).isVisible());
    assert(await footer.getByRole('button', { name: 'Apply cast edits →' }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/editing-cast-${width}-${appearance}.png`, fullPage: true });
    await footer.screenshot({ path: `${out}/editing-cast-footer-${width}-${appearance}.png` });
    results.push({ width, appearance, cast: metrics, voices: voiceMetrics, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ url, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
