/** Verify the safe standalone preview and progressive hero enhancement. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/tmp/meowdiobooks-preview-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const [label, viewport, motion, fallback] of [
    ['desktop-motion', { width: 1440, height: 1000 }, 'no-preference', false],
    ['phone-reduced', { width: 390, height: 844 }, 'reduce', false],
    ['phone-no-motion-allocation', { width: 390, height: 844 }, 'no-preference', false],
    ['desktop-no-webgl', { width: 1440, height: 1000 }, 'no-preference', true],
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: motion });
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url()); return route.abort();
    });
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame;
      window.__designFrames = 0;
      window.__releasedBuffers = 0;
      const deletion = WebGL2RenderingContext.prototype.deleteBuffer;
      WebGL2RenderingContext.prototype.deleteBuffer = function(buffer) { window.__releasedBuffers++; return deletion.call(this, buffer); };
      window.requestAnimationFrame = callback => raf.call(window, time => { window.__designFrames++; callback(time); });
    });
    if (fallback) await page.addInitScript(() => {
      const context = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (String(type).startsWith('webgl')) return null;
        return context.call(this, type, ...args);
      };
    });
    await page.goto(url);
    const ready = page.getByText('Synthetic data · safe to explore', { exact: true });
    await ready.waitFor().catch(async error => {
      await writeFile(`${out}/${label}-error.json`, JSON.stringify({ errors, apiRequests, body: await page.locator('body').innerText() }, null, 2));
      await page.screenshot({ path: `${out}/${label}-error.png` });
      throw error;
    });
    await page.locator('.folio-installation').waitFor({ state: 'attached' });
    let state;
    if (motion === 'no-preference' && !fallback && viewport.width > 600) {
      await page.locator('.sound-field[data-render-state="active"] canvas').waitFor();
      const first = await page.evaluate(() => window.__designFrames);
      await page.waitForTimeout(220);
      assert(await page.evaluate(() => window.__designFrames) > first, 'Hero should render frames while visible');
      state = 'active';
      await page.screenshot({ path: `${out}/desktop-motion-active.png`, fullPage: true });
      // Put the real hero outside the viewport, then prove scheduling resumes.
      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.id = 'review-scroll-spacer'; spacer.style.height = '2400px';
        document.body.append(spacer); window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(220);
      const offscreenFrames = await page.evaluate(() => window.__designFrames);
      await page.waitForTimeout(160);
      assert.equal(await page.evaluate(() => window.__designFrames), offscreenFrames, 'Offscreen hero must stop scheduled rendering');
      await page.evaluate(() => { document.querySelector('#review-scroll-spacer').remove(); window.scrollTo(0, 0); });
      await page.waitForTimeout(220);
      assert(await page.evaluate(() => window.__designFrames) > offscreenFrames, 'Visible hero must resume rendering');
      const buffersBefore = await page.evaluate(() => window.__releasedBuffers);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.sound-field[data-render-state="static"]').waitFor({ state: 'attached' });
      assert.equal(await page.locator('.sound-field canvas').count(), 0, 'Reduced motion must release WebGL');
      assert(await page.evaluate(() => window.__releasedBuffers) > buffersBefore, 'Reduced motion must dispose GPU buffers');
      const stopped = await page.evaluate(() => window.__designFrames);
      await page.waitForTimeout(160);
      assert.equal(await page.evaluate(() => window.__designFrames), stopped, 'Reduced motion must stop scheduled rendering');
    } else {
      await page.locator('.sound-field[data-render-state="static"]').waitFor({ state: 'attached' });
      assert.equal(await page.locator('.sound-field canvas').count(), 0);
      state = 'static';
    }
    await page.screenshot({ path: `${out}/${label}.png`, fullPage: true });
    const select = page.getByRole('combobox', { name: 'Preview', exact: true });
    for (const scenario of ['library', 'cast-inspector', 'review-recovery', 'generate-failed', 'home']) {
      await select.selectOption(scenario);
      await page.waitForFunction(scenario => {
        const control = document.querySelector('.preview-controls select');
        return control?.value === scenario && !control.disabled && document.querySelector('.preview-controls [role="status"]')?.textContent === 'Synthetic data · safe to explore';
      }, scenario);
      assert.equal(new URL(page.url()).pathname, '/studio.html', 'Fixture navigation must preserve preview entry point');
      assert.equal(await page.getByRole('alert').filter({ hasText: 'Could not prepare' }).count(), 0);
    }
    await page.getByRole('button', { name: /^Library/ }).click();
    assert.equal(new URL(page.url()).pathname, '/studio.html');
    await page.reload();
    await ready.waitFor();
    assert.equal(await page.locator('.preview-controls').count(), 1, 'Reload must stay in synthetic preview');
    assert.deepEqual(apiRequests, [], 'Synthetic preview must never request real API endpoints');
    assert.deepEqual(errors, [], 'Browser runtime must be error-free');
    results.push({ label, heroState: state, reducedMotionRelease: label === 'desktop-motion', offscreenScheduling: label === 'desktop-motion' ? 'paused-and-resumed' : 'static', previewNavigationAndReload: 'passed', apiRequests, errors });
    await page.close();
  }
  for (const change of ['reduced-motion', 'phone-layout']) {
  const racing = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  let unblock;
  let started;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await racing.route('**/three.js*', async route => { started(); await blocked; await route.continue(); });
  await racing.goto(url, { waitUntil: 'domcontentloaded' });
  await requested;
  if (change === 'reduced-motion') await racing.emulateMedia({ reducedMotion: 'reduce' });
  else await racing.setViewportSize({ width: 390, height: 844 });
  unblock();
  await racing.waitForLoadState('networkidle');
  assert.equal(await racing.locator('.sound-field canvas').count(), 0, `A pending Three.js import must not activate after ${change}`);
  assert.equal(await racing.locator('.sound-field').getAttribute('data-render-state'), 'static');
  results.push({ label: `pending-import-${change}`, canvasCount: 0, heroState: 'static' });
  await racing.close();
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ preview: url, generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
