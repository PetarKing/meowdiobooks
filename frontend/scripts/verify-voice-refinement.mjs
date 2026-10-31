import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {chooseAppearance} from './appearance-controls.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '/private/tmp/voice-refinement-evidence';
await mkdir(out, {recursive: true});
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({viewport: {width, height: width > 600 ? 900 : 844}, reducedMotion: 'reduce'});
    const pageErrors = [], apiRequests = [], nativeDialogs = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(base);
    await page.getByText('Synthetic data · safe to explore', {exact: true}).waitFor();
    await chooseAppearance(page, appearance);
    const preview = page.getByRole('combobox', {name: 'Preview', exact: true});
    await preview.selectOption('cast-inspector');
    const dialog = page.getByRole('dialog', {name: 'Alice voice'});
    await dialog.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 0));
    await page.addScriptTag({path: 'node_modules/axe-core/axe.min.js'});
    const axe = async selector => page.evaluate(async selector => (await window.axe.run(selector)).violations.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})), selector);
    const bounds = await dialog.boundingBox();
    assert(bounds);
    if (width > 600) {
      assert(Math.abs(bounds.x - (width - bounds.x - bounds.width)) <= 2, 'Voice dialog is horizontally centered');
      assert(bounds.y > 0 && bounds.y + bounds.height < 900, 'Voice dialog floats within the viewport');
    } else {
      assert(Math.abs(bounds.width - width) <= 1 && Math.abs(bounds.height - 844) <= 1, 'Voice dialog fills phone viewport');
    }
    assert.equal(await dialog.locator('audio[controls]').count(), 0, 'Auditions use one designed playback control');
    assert(await dialog.getByRole('button', {name: 'Play Audition 3'}).isVisible());
    assert.deepEqual(await axe('.voice-inspector'), [], 'Audition inspector accessibility');
    await page.screenshot({path: `${out}/auditions-${width}-${appearance}.png`});
    await dialog.getByRole('button', {name: 'Create a new audition'}).click();
    await dialog.getByRole('heading', {name: 'Create a new audition'}).waitFor();
    assert.equal(await dialog.getByText('The Ghost').count(), 0);
    assert(await dialog.getByRole('button', {name: 'Generate new audition →'}).isVisible());
    assert.deepEqual(await axe('.voice-inspector'), [], 'New Voice accessibility');
    const innerOverflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth);
    assert(innerOverflow <= 1, `Voice dialog has no horizontal overflow: ${innerOverflow}px`);
    await page.screenshot({path: `${out}/new-voice-${width}-${appearance}.png`});
    if (width <= 600) {
      await dialog.getByRole('button', {name: 'Generate new audition →'}).scrollIntoViewIfNeeded();
      await page.screenshot({path: `${out}/new-voice-bottom-${width}-${appearance}.png`});
    }
    await dialog.getByRole('button', {name: 'Close voice'}).click();
    await dialog.waitFor({state: 'hidden'});
    await preview.selectOption('cast-missing');
    const board = page.getByRole('region', {name: 'Cast voice auditions'});
    await board.waitFor();
    const required = board.getByRole('button', {name: 'Open Alice voice'});
    assert(await required.getByText('Audition required').isVisible(), 'Required review is readable on the voice tile');
    const requiredDialog = page.getByRole('dialog', {name: 'Alice voice'});
    if (await requiredDialog.isVisible()) {
      await requiredDialog.getByRole('button', {name: 'Close voice'}).click();
      await requiredDialog.waitFor({state: 'hidden'});
    }
    await page.screenshot({path: `${out}/required-${width}-${appearance}.png`, fullPage: true});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `No horizontal overflow: ${overflow}px`);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(nativeDialogs, []);
    results.push({width, appearance, centered: width > 600, newVoice: true, designedPlayback: true, requiredVisible: true, axe: '0 scoped violations', overflow, innerOverflow});
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${out}/report.json`, JSON.stringify({base, executedAt: new Date().toISOString(), scope: 'Synthetic design fixture; no backend generation or persisted revisions.', results}, null, 2));
console.log(JSON.stringify(results));
