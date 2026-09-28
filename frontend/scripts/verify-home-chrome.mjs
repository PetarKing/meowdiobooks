/** Inspect the local design fixture; never touches a live workflow gateway. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/studio.html';
const out = process.argv[3] ?? '../docs/matcha-next/evidence/chrome';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], apiRequests = [], nativeDialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(`Failed ${request.url()}: ${request.failure()?.errorText}`));
    page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
    await page.route('**/api/**', route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      apiRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await page.waitForFunction(() => /Synthetic data|Could not prepare/.test(document.querySelector('.preview-controls [role="status"]')?.textContent ?? ''));
    assert.equal(await page.locator('.preview-error').count(), 0, await page.locator('.preview-error').count() ? await page.locator('.preview-error').textContent() : 'Preview ready');
    await chooseAppearance(page, appearance);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    const card = page.locator('.recent-books article');
    assert.equal(await card.count(), 1);
    const bookCard = await card.boundingBox();
    assert(bookCard && bookCard.width >= 270 && bookCard.width <= 460, `Book shelf card width ${bookCard?.width}`);
    assert(await card.getByRole('button', { name: /Continue/ }).isVisible());
    assert(await card.getByRole('button', { name: /Delete/ }).isVisible());
    assert((await card.getByRole('button', { name: /Continue/ }).boundingBox()).height >= 300);
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `Home overflow: ${overflow}`);
    await page.screenshot({ path: `${out}/home-one-${width}-${appearance}.png`, fullPage: true });

    await page.getByRole('combobox', { name: 'Preview' }).selectOption('home-shelf');
    await page.waitForFunction(() => document.querySelectorAll('.recent-books article').length === 6);
    const cards = await page.locator('.recent-books article').all();
    const cardBoxes = await Promise.all(cards.map(card => card.boundingBox()));
    assert(cardBoxes.every(box => box && box.width >= 270 && box.width <= 460));
    assert.equal(new Set(cardBoxes.map(box => Math.round(box.y))).size, width > 750 ? 2 : 6);
    assert(await page.getByText('A Very Long Book Title That Takes More Than One Line').isVisible());
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `Six-book shelf overflow: ${overflow}`);
    await page.screenshot({ path: `${out}/home-six-${width}-${appearance}.png`, fullPage: true });
    const deleteButton = page.getByRole('button', { name: 'Delete The Moonlit Temple' });
    await deleteButton.click();
    assert(await page.getByRole('dialog', { name: /Delete “The Moonlit Temple”/ }).isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert(await deleteButton.evaluate(el => el === document.activeElement), 'Cancel returns focus to the book');

    await page.getByRole('combobox', { name: 'Preview' }).selectOption('generate');
    await page.waitForFunction(() => /Synthetic data|Could not prepare/.test(document.querySelector('.preview-controls [role="status"]')?.textContent ?? ''));
    assert.equal(await page.locator('.preview-error').count(), 0, await page.locator('.preview-error').count() ? await page.locator('.preview-error').textContent() : 'Preview ready');
    const tabs = page.getByRole('tablist', { name: 'Filter chapters' });
    const all = tabs.getByRole('tab', { name: /All/ });
    await all.click();
    assert.equal(await all.evaluate(el => el.matches(':focus-visible')), false, 'Mouse focus is not persistent');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert(await all.evaluate(el => el.matches(':focus-visible')), 'Keyboard tab returns a visible focus indicator');
    await page.keyboard.press('ArrowRight');
    const next = tabs.getByRole('tab', { name: /To make/ });
    assert.equal(await next.getAttribute('aria-selected'), 'true');
    await page.waitForTimeout(250);
    const focusStyle = await next.evaluate(el => ({ focused: el === document.activeElement, focusVisible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, background: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow }));
    assert.equal(focusStyle.focused, true);
    assert.equal(focusStyle.focusVisible, true);
    assert.equal(focusStyle.outline, 'none');
    assert.notEqual(focusStyle.background, 'rgba(0, 0, 0, 0)');
    await tabs.screenshot({ path: `${out}/tabs-keyboard-${width}-${appearance}.png` });
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `Generate overflow: ${overflow}`);
    assert.deepEqual(nativeDialogs, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    results.push({ width, appearance, homeBookCardWidth: bookCard.width, sixBookCardWidths: cardBoxes.map(box => box.width), deleteDialog: 'custom and Escape restores focus', nativeDialogs, mouseFocusUnboxed: true, keyboardFocus: focusStyle, overflow, errors, apiRequests });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify({ url, executedAt: new Date().toISOString(), scope: 'Synthetic local home and Generate presentation; no backend operation.', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
