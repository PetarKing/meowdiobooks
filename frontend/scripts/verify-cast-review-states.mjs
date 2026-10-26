/** Verify the synthetic Cast and Voices review spectrum in a rendered browser. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '../.review-evidence/cast-review-states';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    await chooseAppearance(page, appearance);
    const preview = page.getByRole('combobox', { name: 'Preview' });

    await preview.selectOption('cast-review-states');
    const castBoard = page.getByRole('region', { name: 'Cast members' });
    const mandatoryIdentity = castBoard.getByRole('button', { name: 'Inspect Royal Chorus' });
    const advisoryIdentity = castBoard.getByRole('button', { name: 'Inspect Queen of Hearts' });
    const readyIdentity = castBoard.getByRole('button', { name: 'Inspect Alice' });
    await mandatoryIdentity.getByText('Required review').waitFor({ state: 'visible' });
    await advisoryIdentity.getByText('Review suggested').waitFor({ state: 'visible' });
    assert.equal(await readyIdentity.locator('.cast-review-badge').count(), 0);
    await page.getByText('1 required · blocks continue').waitFor({ state: 'visible' });
    await page.getByText('1 suggested · optional').waitFor({ state: 'visible' });
    const castContinue = page.getByRole('button', { name: 'Next →' });
    assert(await castContinue.isDisabled(), 'Required identity blocks proceeding to auditions');
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
    await page.screenshot({ path: `${out}/cast-${width}-${appearance}.png` });
    await mandatoryIdentity.click();
    const identityDialog = page.getByRole('dialog', { name: 'Inspect Royal Chorus' });
    await identityDialog.getByText('Required before continuing').waitFor({ state: 'visible' });
    await identityDialog.getByRole('button', { name: 'Confirm classification' }).waitFor({ state: 'visible' });
    await identityDialog.screenshot({ path: `${out}/cast-required-dialog-${width}-${appearance}.png` });
    await identityDialog.getByRole('button', { name: 'Close cast member' }).click();
    await identityDialog.waitFor({ state: 'hidden' });
    await advisoryIdentity.click();
    const advisoryDialog = page.getByRole('dialog', { name: 'Inspect Queen of Hearts' });
    await advisoryDialog.getByText('Optional check').waitFor({ state: 'visible' });
    assert.equal(await advisoryDialog.getByRole('button', { name: /Confirm/ }).count(), 0);
    await advisoryDialog.screenshot({ path: `${out}/cast-advisory-dialog-${width}-${appearance}.png` });
    await advisoryDialog.getByRole('button', { name: 'Close cast member' }).click();
    await advisoryDialog.waitFor({ state: 'hidden' });
    await mandatoryIdentity.click();
    await page.getByRole('dialog', { name: 'Inspect Royal Chorus' }).getByRole('button', { name: 'Confirm classification' }).click();
    await page.getByRole('dialog', { name: 'Inspect Royal Chorus' }).waitFor({ state: 'hidden' });
    assert(await castContinue.isEnabled(), 'Confirming required identity unlocks Continue while advisory review remains');
    await advisoryIdentity.getByText('Review suggested').waitFor({ state: 'visible' });

    await preview.selectOption('cast-voice-review-states');
    const voiceBoard = page.getByRole('region', { name: 'Cast voice auditions' });
    const mandatoryVoice = voiceBoard.getByRole('button', { name: 'Open Alice voice' });
    const advisoryVoice = voiceBoard.getByRole('button', { name: 'Open White Rabbit voice' });
    const approvedVoice = voiceBoard.getByRole('button', { name: 'Open The Hatter voice' });
    await mandatoryVoice.getByText('Audition required').waitFor({ state: 'visible' });
    if (width > 600) await mandatoryVoice.getByText('Blocks continue').waitFor({ state: 'visible' });
    else assert.equal(await mandatoryVoice.getByText('Blocks continue').count(), 1, 'Full consequence remains accessible on phone');
    await advisoryVoice.getByText('Not yet approved').waitFor({ state: 'visible' });
    if (width > 600) await advisoryVoice.getByText('Can continue').waitFor({ state: 'visible' });
    else assert.equal(await advisoryVoice.getByText('Can continue').count(), 1, 'Optional consequence remains accessible on phone');
    assert.equal(await approvedVoice.locator('.voice-tile-alert').count(), 0);
    const acceptVoices = page.getByRole('button', { name: 'Accept cast & voices →' });
    assert(await acceptVoices.isDisabled(), 'Missing audition blocks Cast acceptance');
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
    await page.screenshot({ path: `${out}/voices-${width}-${appearance}.png` });
    await mandatoryVoice.click();
    const voiceDialog = page.getByRole('dialog', { name: 'Alice voice' });
    await voiceDialog.getByText('Required before continuing').waitFor({ state: 'visible' });
    await voiceDialog.screenshot({ path: `${out}/voice-required-dialog-${width}-${appearance}.png` });
    await voiceDialog.getByRole('button', { name: 'Close voice' }).click();
    await voiceDialog.waitFor({ state: 'hidden' });
    await advisoryVoice.click();
    const advisoryVoiceDialog = page.getByRole('dialog', { name: 'White Rabbit voice' });
    await advisoryVoiceDialog.getByText('Optional check').waitFor({ state: 'visible' });
    await advisoryVoiceDialog.screenshot({ path: `${out}/voice-advisory-dialog-${width}-${appearance}.png` });
    await advisoryVoiceDialog.getByRole('button', { name: 'Close voice' }).click();
    await advisoryVoiceDialog.waitFor({ state: 'hidden' });
    await mandatoryVoice.click();
    const firstAuditionDialog = page.getByRole('dialog', { name: 'Alice voice' });
    await firstAuditionDialog.getByRole('button', { name: 'Create a new audition' }).click();
    await firstAuditionDialog.getByRole('button', { name: 'Generate new audition →' }).click();
    await page.getByRole('dialog', { name: 'Create a replacement audition?' }).getByRole('button', { name: 'Create audition →' }).click();
    await firstAuditionDialog.getByRole('button', { name: 'Play Audition 1' }).waitFor({ state: 'visible' });
    await firstAuditionDialog.getByRole('button', { name: 'Close voice' }).click();
    await firstAuditionDialog.waitFor({ state: 'hidden' });
    assert(await acceptVoices.isEnabled(), 'A new audition unlocks acceptance while optional review remains');
    await acceptVoices.click();
    await page.getByText('Approval confirmation', { exact: true }).waitFor({ state: 'visible' });

    assert.deepEqual(errors, []);
    results.push({ width, appearance, cast: 'required/advisory/ready', voices: 'required/advisory/approved', errors });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
