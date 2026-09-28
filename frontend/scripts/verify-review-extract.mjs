/** Synthetic rendered evidence for Review return and full-page Extract comparison. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:5180/studio.html';
const out = path.resolve(process.argv[3] ?? path.join(frontend, '../docs/matcha-next/evidence/review-extract'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const alicePage = await readFile(path.join(out, 'alice-source-page-1.png'));
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const scenario of ['review-intro', 'extract']) {
    const page = await browser.newPage({ viewport: { width, height: width > 700 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(url);
    try { await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) {
      console.error('Initial fixture failed', width, theme, scenario, page.url(), await page.locator('body').innerText(), errors);
      await page.screenshot({ path: path.join(out, `initial-${scenario}-${width}-${theme}-failed.png`), fullPage: true });
      throw error;
    }
    await chooseAppearance(page, theme);
    await page.locator('.preview-controls select').selectOption(scenario);
    try { await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor({ timeout: 12000 }); }
    catch (error) {
      console.error('Fixture failed', scenario, width, theme, await page.locator('.preview-controls').innerText(), await page.locator('.preview-error').allTextContents());
      await page.screenshot({ path: path.join(out, `${scenario}-${width}-${theme}-failed.png`), fullPage: true });
      throw error;
    }
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${scenario}/${width}/${theme} overflow ${overflow}px`);
    const row = { scenario, width, theme, overflow, errors, apiRequests };
    if (scenario === 'review-intro') {
      await page.getByRole('heading', { name: 'A closer look at the story' }).waitFor();
      assert(await page.getByRole('button', { name: 'Scan for issues →' }).isVisible());
      row.invitation = 'visible';
    } else {
      row.page = await page.locator('.extract-page-comparison').evaluate(comparison => {
        const paper = comparison.querySelector('.paper');
        const image = paper.querySelector('img');
        const rect = image.getBoundingClientRect();
        const paperRect = paper.getBoundingClientRect();
        return {
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          renderedWidth: rect.width, renderedHeight: rect.height,
          pageBottom: rect.bottom, paperBottom: paperRect.bottom,
          sourceScrollHeight: paper.scrollHeight, sourceClientHeight: paper.clientHeight,
        };
      });
      assert(row.page.naturalHeight > 0 && row.page.renderedHeight > 0, 'PDF preview loaded');
      assert(row.page.pageBottom <= row.page.paperBottom + 1, 'Whole PDF page fits source pane');
      assert(row.page.sourceScrollHeight <= row.page.sourceClientHeight + 1, 'Source pane does not crop/scroll PDF page');
      assert(Math.abs(row.page.renderedHeight / row.page.renderedWidth - row.page.naturalHeight / row.page.naturalWidth) < .01, 'PDF page retains intrinsic ratio');
    }
    await page.screenshot({ path: path.join(out, `${scenario}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    await page.addScriptTag({ path: path.join(frontend, 'node_modules/axe-core/axe.min.js') });
    row.violations = await page.evaluate(async () => (await window.axe.run('[data-presentation-root]')).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.equal(row.violations.length, 0, `${scenario}/${width}/${theme} axe violations`);
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    results.push(row);
    await page.close();
  }
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width > 700 ? 1000 : 844 }, reducedMotion: 'reduce' });
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.locator('.preview-controls select').selectOption('extract');
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await page.locator('.extract-page-comparison img').evaluate(async (image, data) => {
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
    }, alicePage.toString('base64'));
    const source = await page.locator('.extract-page-comparison .paper').evaluate(paper => {
      const image = paper.querySelector('img');
      const imageRect = image.getBoundingClientRect();
      const paperRect = paper.getBoundingClientRect();
      return {
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        renderedWidth: imageRect.width, renderedHeight: imageRect.height,
        imageBottom: imageRect.bottom, paperBottom: paperRect.bottom,
        scrollHeight: paper.scrollHeight, clientHeight: paper.clientHeight,
      };
    });
    assert(source.imageBottom <= source.paperBottom + 1, 'Real Alice page is fully visible');
    assert(source.scrollHeight <= source.clientHeight + 1, 'Real Alice page source pane has no internal crop');
    assert(Math.abs(source.renderedHeight / source.renderedWidth - source.naturalHeight / source.naturalWidth) < .01, 'Real Alice page ratio preserved');
    await page.screenshot({ path: path.join(out, `alice-page-extract-${width}-light.png`), fullPage: true, animations: 'disabled' });
    results.push({ scenario: 'public-domain Alice page 1 injected into synthetic Extract preview', width, theme: 'light', source });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.goto(url);
  await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  await page.locator('.preview-controls select').selectOption('review-accepted');
  await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Change settings →' }).click();
  await page.getByRole('heading', { name: 'Review your manuscript' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Scan for issues →' }).count(), 0, 'Return to accepted Review has no extra scan click');
  assert.equal(await page.getByRole('heading', { name: 'Review complete' }).count(), 0, 'New candidate is visible');
  await page.screenshot({ path: path.join(out, 'review-return-1440-light.png'), fullPage: true, animations: 'disabled' });
  results.push({ scenario: 'review-return', width: 1440, theme: 'light', candidate: 'shown after one Change settings click', acceptedArtifact: 'not republished' });
  await page.close();
} finally { await browser.close(); }
await writeFile(path.join(out, 'report.json'), JSON.stringify({ url, executedAt: new Date().toISOString(), synthetic: true, results }, null, 2));
console.log(JSON.stringify(results.map(({ scenario, width, theme, overflow, page, violations }) => ({ scenario, width, theme, overflow, page, violations })), null, 2));
