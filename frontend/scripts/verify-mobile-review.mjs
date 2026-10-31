/** Synthetic production-UI proof; never connects to a real book or provider. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const after = process.argv[2] ?? 'http://127.0.0.1:6017';
const before = process.argv[3];
const out = path.resolve(process.argv[4] ?? fileURLToPath(new URL('../../.review-evidence/mobile-review', import.meta.url)));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce', recordVideo: width === 390 && theme === 'dark' ? { dir: out } : undefined });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
    await page.goto(`${after}/iframe.html?id=product-mobile-review-navigation--split-title&viewMode=story`);
    await page.getByRole('heading', { name: 'Chapter starts' }).waitFor();
    await chooseAppearance(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const passage = page.getByLabel('Manuscript context');
    assert((await passage.textContent()).includes('RE C ORD S'));
    assert((await passage.textContent()).includes('The first day began with a letter.'));
    assert.equal(await passage.locator('mark').textContent(), 'MARA');
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.locator('.review-next-action').evaluate(el => getComputedStyle(el).position), 'static');
    assert.equal(await page.getByRole('button', { name: /^Continue review:/ }).count(), 0, 'No redundant continue action before answering');
    await page.screenshot({ path: path.join(out, `chapter-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    assert.equal(await page.getByRole('button', { name: 'View original page' }).count(), 0);
    await page.evaluate(() => {
      window.reviewScrollCalls = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options) {
        window.reviewScrollCalls.push(this.textContent);
        return original.call(this, options);
      };
    });
    const groups = page.getByRole('navigation', { name: 'Review groups' });
    await groups.getByRole('button', { name: /AI suggestions/ }).click();
    await page.getByRole('button', { name: /^Keep original text Keep the original/ }).click();
    await page.waitForFunction(() => document.querySelector('.occurrence-meta')?.textContent?.includes('Example 2 of 2'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width <= 700) assert(await page.locator('.review-strip > button.active').evaluate(el => el === document.activeElement), 'Unfinished examples retain category context');
    await page.evaluate(() => { window.reviewScrollCalls = []; });
    await page.getByRole('button', { name: /^Apply all suggested choices/ }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width <= 700) {
      assert.deepEqual(await page.evaluate(() => window.reviewScrollCalls), [], 'Bulk completion must not scroll');
      assert((await page.locator('.occurrence-meta').textContent()).includes('Example 2 of 2'), 'Bulk completion preserves the current example');
    }
    if (width <= 700) await page.getByText('This category is complete', { exact: true }).waitFor();
    const next = page.getByRole('button', { name: 'Continue review: Chapter starts →' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${width}/${theme}: horizontal overflow ${overflow}`);
    if (width <= 700) {
      await next.scrollIntoViewIfNeeded();
      assert(await next.isEnabled());
      assert.equal(await page.getByRole('button', { name: 'Review complete transcript →' }).isVisible(), false);
    } else {
      assert.equal(await next.isVisible(), false, 'Desktop retains its category navigation');
      assert(await page.getByRole('button', { name: 'Review complete transcript →' }).isDisabled());
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `category-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    if (width <= 700) {
      await next.click();
      await page.waitForFunction(() => document.activeElement?.matches('.review-strip > button.active') && Math.abs(document.querySelector('.review-queue').getBoundingClientRect().top - 110) < 2);
      const queueBox = await page.getByRole('complementary', { name: 'Decision queue' }).boundingBox();
      assert(queueBox.y >= 90 && queueBox.y < 150, 'Decision queue is below the header');
    } else {
      await groups.getByRole('button', { name: /Chapter starts/ }).click();
      assert.equal(await page.getByRole('heading', { name: 'Chapter starts' }).evaluate(el => el === document.activeElement), false, 'Desktop focus stays on navigation');
    }
    await page.evaluate(() => { window.reviewScrollCalls = []; });
    await page.getByRole('button', { name: /^Start a new chapter/ }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width <= 700) {
      assert.deepEqual(await page.evaluate(() => window.reviewScrollCalls), [], 'Chapter completion must not scroll');
      assert(await page.getByRole('heading', { name: 'Chapter starts' }).isVisible());
      await page.getByRole('button', { name: 'Continue review: Suspicious extracted text →' }).click();
    }
    await page.getByRole('heading', { name: 'Suspicious extracted text' }).waitFor();
    await page.getByRole('button', { name: /^Keep as is/ }).click();
    assert(await page.getByRole('button', { name: 'Review complete transcript →' }).isEnabled());
    await page.getByRole('button', { name: 'Review complete transcript →' }).click();
    await page.getByRole('article', { name: 'Audiobook transcript page 1' }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'Final check starts at the top after loading');
    assert(await page.getByRole('main').evaluate(el => el === document.activeElement), 'Final check receives keyboard focus');
    if (theme === 'dark' && [390, 1440].includes(width)) await page.screenshot({ path: path.join(out, `final-check-${width}.png`), animations: 'disabled' });
    await page.evaluate(() => {
      window.reviewPageResets = [];
      const original = window.scrollTo;
      window.scrollTo = function(...args) { window.reviewPageResets.push(args); return original.apply(this, args); };
    });
    await page.getByRole('button', { name: 'Next transcript page' }).click();
    await page.getByRole('article', { name: 'Audiobook transcript page 2' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewPageResets), [], 'Transcript paging must not reset the screen');
    await page.getByRole('button', { name: '← Back to decisions' }).click();
    assert.equal(await page.evaluate(() => scrollY), 0, 'Back to decisions starts at the top');
    assert(await page.getByRole('main').evaluate(el => el === document.activeElement));
    await groups.getByRole('button', { name: /AI suggestions/ }).click();
    assert.equal(await page.getByRole('button', { name: /^Keep original text Keep the original/ }).getAttribute('aria-pressed'), 'true');
    assert(await page.getByRole('button', { name: 'Review complete transcript →' }).isEnabled());
    await page.addScriptTag({ path: fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)) });
    const violations = await page.evaluate(async () => (await window.axe.run('[data-presentation-root]')).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `${width}/${theme}: accessibility violations`);
    assert.deepEqual(errors, []);
    results.push({ width, theme, overflow, completeJourney: true, manualChoicePreserved: true, finalCheckStartsAtTop: true, finalCheckFocus: true, paginationDoesNotReset: true, categoryCompletionDoesNotScroll: width <= 700 ? true : null, violations });
    await page.close();
  }
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion });
    await page.goto(`${after}/iframe.html?id=product-mobile-review-navigation--suggestions&viewMode=story`);
    await page.getByRole('heading', { name: 'AI suggestions' }).waitFor();
    await page.getByRole('button', { name: /^Apply all suggested choices/ }).click();
    const next = page.getByRole('button', { name: 'Continue review: Chapter starts →' });
    await next.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.reviewMotion = { calls: [], positions: [] };
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options) {
        window.reviewMotion.calls.push(options);
        return original.call(this, options);
      };
      addEventListener('scroll', () => window.reviewMotion.positions.push(scrollY));
    });
    await next.click();
    await page.waitForFunction(() => {
      const queue = document.querySelector('.review-queue');
      const active = document.querySelector('.review-strip > button.active');
      return active === document.activeElement && Math.abs(queue.getBoundingClientRect().top - 110) < 2;
    });
    const motion = await page.evaluate(() => window.reviewMotion);
    if (reducedMotion === 'no-preference') await page.screenshot({ path: path.join(out, 'decision-queue-390.png'), animations: 'disabled' });
    const behavior = reducedMotion === 'reduce' ? 'instant' : 'smooth';
    assert.equal(motion.calls.at(-1).behavior, behavior);
    if (reducedMotion === 'no-preference') assert(new Set(motion.positions).size > 2, 'Smooth navigation has intermediate scroll positions');
    results.push({ width: 390, reducedMotion, reviewScrollBehavior: behavior, intermediatePositions: new Set(motion.positions).size });
    await page.close();
  }
  if (before) for (const width of [390, 1440]) for (const story of ['split-title', 'finished-category']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await page.goto(`${before}/iframe.html?id=product-mobile-review-navigation--split-title&viewMode=story`);
    await page.getByRole('heading', { name: 'Chapter starts' }).waitFor();
    if (story === 'finished-category') {
      await page.getByRole('navigation', { name: 'Review groups' }).getByRole('button', { name: /AI suggestions/ }).click();
      await page.getByRole('button', { name: /^Keep original text Keep the original/ }).click();
      await page.getByRole('button', { name: /^Apply all suggested choices/ }).click();
      await page.getByRole('button', { name: 'All suggestions decided' }).waitFor();
    }
    await chooseAppearance(page, 'dark');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `before-${story}-${width}-dark.png`), fullPage: true, animations: 'disabled' });
    results.push({ baseline: story, width, disabledTranscript: story === 'finished-category' ? await page.getByRole('button', { name: 'Review complete transcript →' }).isDisabled() : undefined });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(out, 'report.json'), JSON.stringify({ synthetic: true, after, before, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
