/** Render Cast, Voices and Home interactions without opening a real book. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '../docs/matcha-next/evidence/roster-motion';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function washOpacity(locator) {
  return Number(await locator.evaluate(node => getComputedStyle(node, '::after').opacity));
}

try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const record = width === 1440 && appearance === 'dark';
    const page = await browser.newPage({
      viewport: { width, height: 900 }, reducedMotion: 'no-preference',
      ...(record ? { recordVideo: { dir: out, size: { width: 1440, height: 900 } } } : {}),
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const preview = page.getByRole('combobox', { name: 'Preview' });

    await preview.selectOption('cast-review-states');
    const cast = page.getByRole('button', { name: 'Inspect Queen of Hearts' });
    await cast.waitFor();
    await cast.scrollIntoViewIfNeeded();
    const castBox = await cast.boundingBox();
    const castBefore = await washOpacity(cast);
    await cast.hover();
    await pause(500);
    const castAfter = await washOpacity(cast);
    assert(castAfter > castBefore + .5, `Cast ink wash did not reveal: ${castBefore} -> ${castAfter}`);
    assert.deepEqual(await cast.boundingBox(), castBox, 'Cast hover must not move or resize the card');
    await cast.screenshot({ path: `${out}/cast-hover-${width}-${appearance}.png` });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Tab');
    await cast.focus();
    await pause(500);
    assert(await washOpacity(cast) > .9, 'Keyboard focus should reveal the Cast ink wash');
    const castViolations = await page.evaluate(async () => (await window.axe.run('.cast-board')).violations.map(item => item.id));
    assert.deepEqual(castViolations, [], `Cast card accessibility: ${castViolations.join(', ')}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'Cast has no horizontal overflow');

    await preview.selectOption('cast-voice-review-states');
    const voice = page.getByRole('button', { name: 'Open White Rabbit voice' }).locator('..');
    await voice.waitFor();
    await voice.scrollIntoViewIfNeeded();
    const voiceBox = await voice.boundingBox();
    const voiceBefore = await washOpacity(voice);
    await voice.hover();
    await pause(500);
    const voiceAfter = await washOpacity(voice);
    assert(voiceAfter > voiceBefore + .5, `Voice ink wash did not reveal: ${voiceBefore} -> ${voiceAfter}`);
    assert.deepEqual(await voice.boundingBox(), voiceBox, 'Voice hover must not move or resize the card');
    await voice.screenshot({ path: `${out}/voice-hover-${width}-${appearance}.png` });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Tab');
    await voice.getByRole('button', { name: 'Open White Rabbit voice' }).focus();
    await pause(500);
    assert(await washOpacity(voice) > .9, 'Keyboard focus should reveal the Voice ink wash');
    const voiceViolations = await page.evaluate(async () => (await window.axe.run('.voice-cast-board')).violations.map(item => item.id));
    assert.deepEqual(voiceViolations, [], `Voice card accessibility: ${voiceViolations.join(', ')}`);
    await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); HTMLMediaElement.prototype.pause = () => undefined; });
    await voice.getByRole('button', { name: 'Play White Rabbit preview' }).click();
    const playing = voice.getByRole('button', { name: 'Stop White Rabbit preview' });
    await playing.waitFor();
    assert.equal(await playing.locator('.voice-tile-play-cue').count(), 0, 'Playing hides the tiny play cue without a pause icon');
    const bloomAnimation = await playing.evaluate(node => getComputedStyle(node, '::before').animationName);
    assert.equal(bloomAnimation, 'voice-ink-bloom', 'Active playback blooms behind the waveform');
    const sealAnimation = await voice.locator('.cast-roster-curve .curve-horizontal:visible, .cast-roster-curve .curve-vertical:visible').evaluate(node => getComputedStyle(node).animationName);
    assert.equal(sealAnimation, 'roster-curve-audio', 'Only active playback animates continuously');
    const fieldAnimation = await voice.locator('.cast-roster-field:visible').evaluate(node => getComputedStyle(node).animationName);
    assert.equal(fieldAnimation, 'roster-field-tide', 'The monogram field should breathe with active audio');
    await voice.screenshot({ path: `${out}/voice-playing-${width}-${appearance}.png` });
    await playing.click();
    assert(await voice.getByRole('button', { name: 'Play White Rabbit preview' }).isVisible(), 'Pausing restores the initials play target');
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'Voices have no horizontal overflow');

    await preview.selectOption('home-shelf');
    const home = page.locator('.recent-books article').first();
    await home.waitFor();
    await home.scrollIntoViewIfNeeded();
    const homeBox = await home.boundingBox();
    await home.getByRole('button', { name: /Continue/ }).hover();
    await pause(400);
    assert.deepEqual(await home.boundingBox(), homeBox, 'Home hover must not move or resize the card');
    const arrow = home.locator('.recent-book-arrow');
    assert.equal(await arrow.count(), 1);
    assert.notEqual(await arrow.evaluate(node => getComputedStyle(node).transform), 'none', 'Home arrow should respond to hover');
    await home.screenshot({ path: `${out}/home-hover-${width}-${appearance}.png` });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Tab');
    await home.getByRole('button', { name: /Continue/ }).focus();
    assert.notEqual(await arrow.evaluate(node => getComputedStyle(node).transform), 'none', 'Keyboard focus should move the Home arrow');
    const violations = await page.evaluate(async () => (await window.axe.run('.recent-books')).violations.map(item => item.id));
    assert.deepEqual(violations, [], `Home card accessibility: ${violations.join(', ')}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'No horizontal overflow');
    assert.deepEqual(errors, []);
    results.push({ width, appearance, castBefore, castAfter, voiceBefore, voiceAfter, playbackAnimation: sealAnimation, bloomAnimation, fieldAnimation, noLayoutShift: true, noOverflow: true, axeViolations: [...castViolations, ...voiceViolations, ...violations], errors });
    await page.close();
    if (record) await page.video().saveAs(`${out}/cast-voice-home-motion.webm`);
  }

  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduced.goto(url);
  await reduced.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
  await reduced.getByRole('combobox', { name: 'Preview' }).selectOption('cast-review-states');
  const reducedCast = reduced.getByRole('button', { name: 'Inspect Queen of Hearts' });
  await reducedCast.hover();
  const reducedStyle = await reducedCast.evaluate(node => ({
    transition: getComputedStyle(node, '::after').transitionDuration,
    transform: getComputedStyle(node, '::after').transform,
  }));
  assert.equal(reducedStyle.transition, '0s');
  assert.equal(reducedStyle.transform, 'none');
  const reducedCurve = await reducedCast.locator('.cast-roster-curve .curve-horizontal:visible, .cast-roster-curve .curve-vertical:visible').evaluate(node => getComputedStyle(node).animationName);
  assert.equal(reducedCurve, 'none');
  await reduced.getByRole('combobox', { name: 'Preview' }).selectOption('cast-voice-review-states');
  await reduced.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); HTMLMediaElement.prototype.pause = () => undefined; });
  await reduced.getByRole('button', { name: 'Play White Rabbit preview' }).click();
  const reducedPlaying = reduced.getByRole('button', { name: 'Stop White Rabbit preview' });
  await reducedPlaying.waitFor();
  const reducedPlayback = await reducedPlaying.locator('..').locator('.cast-roster-curve .curve-horizontal:visible, .cast-roster-curve .curve-vertical:visible').evaluate(node => getComputedStyle(node).animationName);
  assert.equal(reducedPlayback, 'none');
  const reducedField = await reducedPlaying.locator('..').locator('.cast-roster-field:visible').evaluate(node => getComputedStyle(node).animationName);
  assert.equal(reducedField, 'none');
  const reducedBloom = await reducedPlaying.evaluate(node => getComputedStyle(node, '::before').animationName);
  assert.equal(reducedBloom, 'none');
  await reduced.close();
  await writeFile(`${out}/report.json`, JSON.stringify({ url, results, reducedMotion: { ...reducedStyle, curve: reducedCurve, playback: reducedPlayback, field: reducedField, bloom: reducedBloom } }, null, 2));
  console.log(JSON.stringify({ results, reducedMotion: { ...reducedStyle, curve: reducedCurve, playback: reducedPlayback, field: reducedField, bloom: reducedBloom } }, null, 2));
} finally {
  await browser.close();
}
