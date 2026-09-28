import { chooseAppearance, readAppearance } from './appearance-controls.mjs';
/** Record actual synthetic interactions; no mocked screenshots or production API access. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/sanctuary-recordings';
const filter = new RegExp(process.argv[4] ?? '.*');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, viewport] of [
    ['appearance-and-sanctuary', { width: 1440, height: 900 }],
    ['required-voice-phone', { width: 390, height: 844 }],
    ['generation-failure-phone', { width: 390, height: 844 }],
    ['audition-selection-phone', { width: 390, height: 844 }],
  ]) {
    if (!filter.test(name)) continue;
    const context = await browser.newContext({ viewport, recordVideo: { dir: out, size: viewport } });
    const page = await context.newPage();
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(base);
    const ready = page.getByText('Synthetic data · safe to explore', { exact: true });
    await ready.waitFor();
    const preview = page.getByRole('combobox', { name: 'Preview', exact: true });
    if (name === 'appearance-and-sanctuary') {
      await chooseAppearance(page, 'light');
      await page.locator('.sanctuary-art img').waitFor();
      await page.locator('.sanctuary-art img').evaluate(image => image.decode());
      await page.locator('.sanctuary-art').hover();
      await page.waitForTimeout(2200);
      await chooseAppearance(page, 'dark');
      assert.equal(await page.locator('[data-presentation-root]').getAttribute('data-appearance'), 'dark');
      await page.waitForTimeout(2200);
      await page.reload(); await ready.waitFor();
      assert.equal(await readAppearance(page), 'dark', 'Preference survives reload');
      await page.waitForTimeout(1400);
      await chooseAppearance(page, 'system');
      await page.waitForTimeout(1600);
    } else if (name === 'required-voice-phone') {
      await chooseAppearance(page, 'dark');
      await preview.selectOption('cast-voices-dense');
      const review = page.getByRole('button', { name: 'Review required voices →' });
      await review.waitFor(); await page.waitForTimeout(1300);
      const gate = page.getByRole('button', { name: 'Accept cast & voices →' });
      assert(await gate.isDisabled(), 'Required voice still blocks continuation');
      await review.click();
      const dialog = page.getByRole('dialog', { name: 'Alice & White Rabbit voice' });
      await dialog.waitFor(); await page.waitForTimeout(1800);
      await dialog.getByRole('button', { name: 'Confirm layered voices' }).click();
      await dialog.getByText('Layered route confirmed', { exact: true }).waitFor();
      await page.waitForTimeout(1300);
      await dialog.getByRole('button', { name: 'Close voice' }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert(await gate.isEnabled(), 'Reviewed route enables continuation');
      await page.waitForTimeout(1700);
    } else if (name === 'audition-selection-phone') {
      await chooseAppearance(page, 'dark');
      await preview.selectOption('cast-inspector');
      const dialog = page.getByRole('dialog', { name: 'Alice voice' });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('button', { name: /Delete Audition/ }).count(), 0);
      const candidate = dialog.getByRole('button', { name: 'Apply Audition 1' });
      await candidate.locator('.voice-candidate-summary').click();
      assert.equal(await candidate.getAttribute('aria-pressed'), 'true');
      await page.waitForTimeout(1500);
      await candidate.locator('..').locator('..').locator('audio').click();
      assert.equal(await candidate.getAttribute('aria-pressed'), 'true', 'Listening does not change the applied audition');
      await page.waitForTimeout(1300);
      await dialog.getByRole('button', { name: 'Create a new audition' }).click();
      await dialog.getByRole('button', { name: 'Generate new audition →' }).waitFor();
      await dialog.getByRole('button', { name: 'Back to auditions' }).click();
      await dialog.getByRole('button', { name: 'Close voice' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Open Alice voice' }).click();
      await dialog.waitFor();
      assert.match(await dialog.getByRole('button', { name: 'Apply Audition 1' }).innerText(), /Applied/);
      await page.waitForTimeout(1700);
    } else {
      await chooseAppearance(page, 'light');
      await preview.selectOption('generate-failed');
      const receipt = page.locator('.generation-error');
      await receipt.waitFor();
      await receipt.scrollIntoViewIfNeeded();
      assert.match(await receipt.innerText(), /first three chapters are still saved/);
      assert(await page.getByRole('button', { name: /Generate .*selected/ }).isEnabled(), 'Retry stays available');
      await page.waitForTimeout(3300);
      await chooseAppearance(page, 'dark');
      await receipt.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2200);
    }
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(errors, []);
    const video = page.video();
    await context.close();
    await rename(await video.path(), `${out}/${name}.webm`);
    results.push({ name, viewport, apiRequests, errors, file: `${name}.webm`, passed: true });
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ base, generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
