/** Reproducible browser review of the local synthetic Cast identity fixture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '../.review-evidence/cast-identity';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, reducedMotion: 'reduce' });
    const errors = [], apiRequests = [], nativeDialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    await page.getByRole('combobox', { name: 'Preview', exact: true }).selectOption('cast-identities');
    await page.getByRole('region', { name: 'Cast members' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.preview-error').count(), 0);
    const queen = page.getByRole('button', { name: 'Inspect Queen of Hearts' });
    assert(await queen.isVisible());
    assert((await queen.getAttribute('class')).includes('has-suggestions'));
    assert(!(await queen.getAttribute('class')).includes('needs-review'));
    assert(await queen.getByText('Review suggested', { exact: true }).isVisible());
    await page.screenshot({ path: `${out}/roster-${width}-${appearance}.png`, fullPage: false });

    await queen.click();
    const inspector = page.getByRole('dialog', { name: 'Inspect Queen of Hearts' });
    await inspector.waitFor();
    const matches = inspector.locator('.cast-match-panel');
    assert.equal(await matches.getAttribute('open'), '');
    assert(await matches.getByRole('button', { name: 'Attach' }).isVisible());
    assert(await matches.getByText('Queen', { exact: true }).isVisible());
    const inspectorRect = await inspector.boundingBox();
    assert(inspectorRect && inspectorRect.height < (width > 600 ? 900 : 845));
    await matches.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/suggested-${width}-${appearance}.png`, fullPage: false });
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => (await window.axe.run('.identity-inspector')).violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `Identity inspector accessibility: ${JSON.stringify(violations)}`);

    await matches.getByRole('button', { name: 'Attach' }).click();
    await inspector.getByText('2 attached').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Inspect Queen', exact: true }).count(), 0);
    await inspector.getByText('2 attached').waitFor();
    assert(await inspector.getByText('2 attached').isVisible());
    assert(await inspector.getByText('Queen', { exact: true }).isVisible());
    assert.equal(await inspector.locator('.cast-match-panel').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(nativeDialogs, []);
    results.push({ width, appearance, queenHint: true, matchesOpen: true, attachChangesGroup: true, inspectorHeight: inspectorRect.height, scopedAxeViolations: violations, overflow: 0, errors, apiRequests, nativeDialogs });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ url, executedAt: new Date().toISOString(), scope: 'Synthetic Cast identity fixture; Attach changes draft decisions, not accepted backend state.', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
