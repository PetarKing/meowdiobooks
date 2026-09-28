import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '../docs/matcha-next/evidence/cast-listen-portrait';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) for (const reducedMotion of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    await page.getByRole('combobox', { name: 'Preview' }).selectOption('cast-voices');
    const board = page.getByRole('region', { name: 'Cast voice auditions' });
    await board.waitFor();
    await page.evaluate(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => undefined;
    });

    assert.equal(await board.locator('.voice-tile-listen, .voice-tile-state').count(), 0, 'Separate Listen and repeated status lines are absent');
    const alice = board.getByRole('button', { name: 'Play Alice preview' });
    const openAlice = board.getByRole('button', { name: 'Open Alice voice' });
    assert.equal(await alice.getAttribute('aria-pressed'), 'false');
    assert(await alice.locator('strong').isVisible(), 'Portrait begins with initials');
    assert.equal(await openAlice.getAttribute('aria-description'), 'voice selected');
    assert.equal(await openAlice.innerText(), 'Alice', 'Card body has only the character name');

    await alice.click();
    const pauseAlice = board.getByRole('button', { name: 'Pause Alice preview' });
    assert.equal(await pauseAlice.getAttribute('aria-pressed'), 'true');
    assert.equal(await pauseAlice.locator('strong').count(), 0, 'Initials swap away while playing');
    assert.equal(await pauseAlice.locator('.voice-tile-wave i').count(), 5);
    const animation = await pauseAlice.locator('.voice-tile-wave i').first().evaluate(el => getComputedStyle(el).animationName);
    assert.equal(animation, reducedMotion ? 'none' : 'voice-tile-wave');
    assert.equal(await page.getByRole('dialog', { name: 'Alice voice' }).count(), 0, 'Portrait playback does not open the inspector');
    if (!reducedMotion) await page.screenshot({ path: `${out}/playing-${width}-${appearance}.png`, fullPage: true });

    await pauseAlice.click();
    assert.equal(await alice.getAttribute('aria-pressed'), 'false');
    assert(await alice.locator('strong').isVisible(), 'Pause restores initials');
    await alice.click();
    await page.locator('audio.voice-tile-audio').dispatchEvent('ended');
    await alice.locator('strong').waitFor({ state: 'visible' });

    await alice.click();
    await board.getByRole('button', { name: 'Play White Rabbit preview' }).click();
    assert(await alice.locator('strong').isVisible(), 'Playing a different voice restores the previous portrait');
    assert.equal(await board.getByRole('button', { name: 'Pause White Rabbit preview' }).getAttribute('aria-pressed'), 'true');
    await openAlice.click();
    assert(await page.getByRole('dialog', { name: 'Alice voice' }).isVisible());
    assert(await board.getByRole('button', { name: 'Play White Rabbit preview' }).locator('strong').isVisible(), 'Opening an inspector stops tile playback');

    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
    assert.deepEqual(errors, []);
    results.push({ width, appearance, reducedMotion, portraitPlayPause: true, endedAndSwitchRestoreInitials: true, inspectorSeparate: true, animation, overflow: 0, errors });
    await page.close();
  }
  const actualPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await actualPage.goto(base);
  await actualPage.getByRole('combobox', { name: 'Preview' }).selectOption('cast-voices');
  await actualPage.getByRole('button', { name: 'Play Alice preview' }).click();
  const actualPause = actualPage.getByRole('button', { name: 'Pause Alice preview' });
  await actualPause.waitFor();
  const duration = await actualPage.locator('audio.voice-tile-audio').evaluate(async audio => {
    if (Number.isFinite(audio.duration)) return audio.duration;
    await new Promise(resolve => audio.addEventListener('loadedmetadata', resolve, { once: true }));
    return audio.duration;
  });
  await actualPage.getByRole('button', { name: 'Play Alice preview' }).waitFor({ timeout: 7000 });
  results.push({ actualSyntheticMedia: true, duration, endedAndRestoredInitials: true });
  await actualPage.close();
} finally {
  await browser.close();
}
await writeFile(`${out}/playback-report.json`, JSON.stringify({ base, executedAt: new Date().toISOString(), scope: 'Synthetic silent audio fixture; play and pause methods stubbed to hold UI playback state for inspection.', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
