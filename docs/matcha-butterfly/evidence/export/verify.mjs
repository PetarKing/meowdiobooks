import { chromium } from '../../../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch();
const rows = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: appearance, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5179/studio.html');
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Preview', exact: true }).selectOption('export-long-book');
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Prepare your audiobook', exact: true }).waitFor();
    const theme = page.getByRole('button', { name: 'Toggle dark mode', exact: true });
    if ((await theme.getAttribute('aria-pressed') === 'true') !== (appearance === 'dark')) await theme.click();
    const root = page.locator('.edition-workbench');
    assert.equal(await page.locator('.edition-chapters input:checked').count(), 20);
    const initiallyStyled = await root.locator('.edition-identity').evaluate(el => getComputedStyle(el).display === 'grid');
    assert.ok(initiallyStyled, 'export-stage.css is imported');
    await page.screenshot({ path: `${out}/edition-${width}-${appearance}.png`, fullPage: true });
    // Whole chapter rows toggle the native checkbox; clearing prevents export.
    const first = page.locator('.edition-chapters label').first();
    await first.locator('b').click(); assert.equal(await first.locator('input').isChecked(), false);
    await first.locator('b').click(); assert.equal(await first.locator('input').isChecked(), true);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.locator('.edition-chapters input:checked').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create high-quality M4B →', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    assert.equal(await page.locator('.edition-chapters input:checked').count(), 20);
    const title = page.getByLabel('Title', { exact: true });
    const originalTitle = await title.inputValue();
    const originalCover = await page.getByAltText('Current audiobook cover').getAttribute('src');
    await title.fill(''); assert.equal(await page.getByRole('button', { name: 'Create high-quality M4B →', exact: true }).isDisabled(), true);
    const longTitle = 'The Journey through the Temple Gardens — A Very Long Audiobook Title with 日本語 and an ExtraordinarySubtitleWithoutAnySpaces'.repeat(2);
    await title.fill(longTitle);
    assert.equal(await page.getByRole('region', { name: 'Audiobook preview', exact: true }).getByRole('heading').textContent(), longTitle);
    await page.getByLabel('Author', { exact: true }).fill('A long synthetic author credit with several contributors and 日本語の名前');
    await page.getByRole('radio', { name: /Smaller M4B/ }).check();
    assert.equal(await page.getByRole('button', { name: 'Create smaller M4B →', exact: true }).isEnabled(), true);
    await page.getByRole('radio', { name: /MP3 chapters.*ZIP download/ }).check();
    assert.equal(await page.getByRole('button', { name: 'Create MP3 ZIP →', exact: true }).isEnabled(), true);
    // Synthetic image only; no user data or external resource is involved.
    await page.locator('.edition-upload input').setInputFiles({ name: 'synthetic-cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await page.getByRole('button', { name: 'Use PDF page', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.edition-cover img')?.getAttribute('src')?.startsWith('blob:'));
    const customCover = await page.getByAltText('Current audiobook cover').getAttribute('src'); assert.ok(customCover.startsWith('blob:'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(overflow <= 1, `overflow ${overflow}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/edition-long-metadata-${width}-${appearance}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Reset book details', exact: true }).click();
    assert.equal(await title.inputValue(), originalTitle);
    assert.equal(await page.getByLabel('PDF cover page', { exact: true }).inputValue(), '1');
    await page.waitForFunction(src => document.querySelector('.edition-cover img')?.getAttribute('src') === src, originalCover);
    await page.getByLabel('PDF cover page', { exact: true }).fill('7');
    assert.equal(await page.getByLabel('PDF cover page', { exact: true }).inputValue(), '7');
    await page.addScriptTag({ path: out + '../../../../frontend/node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('.edition-workbench'))).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) })));
    rows.push({ width, appearance, chapters: 20, rowClick: true, emptySelectionGate: true, emptyTitleGate: true, formats: ['m4b-high', 'm4b-compact', 'mp3-chapters'], customCover: true, reset: true, pdfPage: true, overflow, errors, violations });
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    await page.close();
  }
} finally { await browser.close(); await fs.writeFile(out + 'report.json', JSON.stringify(rows, null, 2)); }
console.log(JSON.stringify(rows, null, 2));
