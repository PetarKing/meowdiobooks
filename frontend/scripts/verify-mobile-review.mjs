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
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function landing(page, destination) {
  await page.waitForFunction(destination => {
    const target = document.querySelector(destination === 'queue' ? '.review-queue' : '.review-evidence h2');
    const focus = destination === 'queue' ? document.querySelector('.review-strip > button.active') : target;
    if (!target || focus !== document.activeElement) return false;
    const headerBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
    return Math.abs(target.getBoundingClientRect().top - headerBottom - 12) < 2;
  }, destination);
}
async function startTrace(page) {
  await page.evaluate(() => {
    window.reviewTrace = { calls: [], positions: [] };
    if (window.reviewTraceInstalled) return;
    window.reviewTraceInstalled = true;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options) {
      window.reviewTrace.calls.push({ target: this.className, options });
      return original.call(this, options);
    };
    addEventListener('scroll', () => window.reviewTrace.positions.push(scrollY));
  });
}
try {
  for (const [width, height] of [[320, 844], [390, 844], [650, 1400], [768, 844], [834, 1112], [1440, 844]]) for (const theme of ['light', 'dark']) {
    const mobile = width <= 700;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', recordVideo: width === 390 && theme === 'dark' ? { dir: out } : undefined });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
    await page.goto(`${after}/iframe.html?id=product-mobile-review-navigation--split-title&viewMode=story`);
    await page.getByRole('heading', { name: 'Chapter starts' }).waitFor();
    await chooseAppearance(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const passage = page.getByLabel('Manuscript context');
    assert((await passage.textContent()).includes('RE C ORD S'));
    assert((await passage.textContent()).includes('The first day began with a letter.'));
    assert.equal(await passage.locator('mark').textContent(), 'MARA');
    assert.equal(await page.getByRole('button', { name: /^Continue review:/ }).count(), 0);
    const transcript = page.getByRole('button', { name: 'Review complete transcript →' });
    assert.equal(await transcript.isVisible(), !mobile, 'Transcript action is hidden on mobile before all decisions');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `chapter-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    const groups = page.getByRole('navigation', { name: 'Review groups' });
    await groups.getByRole('button', { name: /AI suggestions/ }).click();
    if (mobile) await landing(page, 'category');
    const suggestion = page.getByRole('button', { name: /^Apply correction/ });
    assert.equal(await suggestion.getAttribute('aria-pressed'), 'false');
    assert.equal(await suggestion.getAttribute('aria-description'), 'Suggested choice for this passage');
    assert((await suggestion.textContent()).includes('✧'));
    const suggestionStyles = await suggestion.evaluate(el => {
      const actual = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.background = 'var(--warning-soft)';
      probe.style.borderColor = 'var(--warning-border)';
      el.append(probe);
      const expected = getComputedStyle(probe);
      const result = { background: actual.backgroundColor, border: actual.borderTopColor, expectedBackground: expected.backgroundColor, expectedBorder: expected.borderTopColor };
      probe.remove();
      return result;
    });
    assert.equal(suggestionStyles.background, suggestionStyles.expectedBackground, 'Suggestion matches Dialogue tint');
    assert.equal(suggestionStyles.border, suggestionStyles.expectedBorder, 'Suggestion matches Dialogue border');
    if (width === 834 && theme === 'dark') await suggestion.screenshot({ path: path.join(out, 'tablet-suggestion.png') });
    await page.getByRole('button', { name: /^Keep original text Keep the original/ }).click();
    await page.waitForFunction(() => document.querySelector('.occurrence-meta')?.textContent?.includes('Example 2 of 2'));
    if (mobile) {
      await landing(page, 'category');
      assert.equal(await transcript.isVisible(), false);
      if (width === 390 && theme === 'dark') await page.screenshot({ path: path.join(out, 'next-example-390.png') });
    }
    await page.getByRole('button', { name: '← Previous example' }).click();
    assert(await suggestion.evaluate(el => el.classList.contains('review-recommended-muted')), 'Declined suggestion is muted');
    assert((await suggestion.textContent()).includes('✧'));
    await page.getByRole('button', { name: 'Next example →' }).click();
    await page.getByRole('button', { name: /^Apply all suggested choices/ }).click();
    if (mobile) {
      await landing(page, 'queue');
      assert(await page.getByRole('heading', { name: 'Chapter starts' }).isVisible(), 'Completion wraps to the next unfinished category in visual queue order');
      assert(await groups.getByRole('button', { name: /AI suggestions/ }).evaluate(el => el.classList.contains('resolved')));
      assert.equal(await transcript.isVisible(), false);
      if (width === 390 && theme === 'dark') await page.screenshot({ path: path.join(out, 'decision-queue-390.png') });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${width}/${theme}: horizontal overflow ${overflow}`);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `category-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    await groups.getByRole('button', { name: /Chapter starts/ }).click();
    if (mobile) await landing(page, 'category');
    await page.getByRole('button', { name: /^Start a new chapter/ }).click();
    if (mobile) {
      await landing(page, 'queue');
      assert.equal(await transcript.isVisible(), false);
      await groups.getByRole('button', { name: /Suspicious extracted text/ }).click();
      await landing(page, 'category');
    }
    const keep = page.getByRole('button', { name: /^Keep as is/ });
    await keep.scrollIntoViewIfNeeded();
    await settle(page);
    const beforeCompletion = await page.evaluate(() => scrollY);
    await startTrace(page);
    await keep.click();
    assert(await transcript.isEnabled());
    if (mobile) {
      await page.waitForFunction(() => document.activeElement?.matches('.review-transcript-continue') && document.activeElement.getBoundingClientRect().bottom <= innerHeight - 10);
      const trace = await page.evaluate(() => window.reviewTrace);
      assert(trace.calls.every(call => call.target.includes('review-transcript-continue') && call.options.block === 'end'), 'Final completion only reveals the final action');
      assert(await page.evaluate(() => scrollY) >= beforeCompletion - 1, 'Final completion never scrolls back up');
      if (width === 390 && theme === 'dark') await page.screenshot({ path: path.join(out, 'all-complete-390.png') });
    }
    assert.equal(await groups.locator('button.active').count(), 0, 'Completed categories have no active fill');
    assert.equal(await groups.locator('button[aria-current="true"]').count(), 1, 'Displayed category is accessible independently of completion');
    await settle(page);
    const completedStyles = await groups.locator('button').evaluateAll(nodes => nodes.map(el => {
      const style = getComputedStyle(el);
      return { resolved: el.classList.contains('resolved'), background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow };
    }));
    assert(completedStyles.every(style => style.resolved && style.background === 'rgba(0, 0, 0, 0)' && style.image === 'none' && style.shadow === 'none'), `All completed cards have the same neutral appearance: ${JSON.stringify(completedStyles)}`);
    if (width === 834 && theme === 'dark') await page.getByRole('complementary', { name: 'Decision queue' }).screenshot({ path: path.join(out, 'tablet-queue-complete.png') });
    await transcript.click();
    await page.getByRole('article', { name: 'Audiobook transcript page 1' }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert(await page.getByRole('main').evaluate(el => el === document.activeElement));
    if (theme === 'dark' && [390, 1440].includes(width)) await page.screenshot({ path: path.join(out, `final-check-${width}.png`) });
    await page.evaluate(() => {
      window.reviewPageResets = [];
      const original = window.scrollTo;
      window.scrollTo = function(...args) { window.reviewPageResets.push(args); return original.apply(this, args); };
    });
    await page.getByRole('button', { name: 'Next transcript page' }).click();
    await page.getByRole('article', { name: 'Audiobook transcript page 2' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewPageResets), []);
    await page.getByRole('button', { name: '← Back to decisions' }).click();
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert(await page.getByRole('main').evaluate(el => el === document.activeElement));
    await groups.getByRole('button', { name: /AI suggestions/ }).click();
    assert.equal(await page.getByRole('button', { name: /^Keep original text Keep the original/ }).getAttribute('aria-pressed'), 'true');
    await page.addScriptTag({ path: fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)) });
    const violations = await page.evaluate(async () => (await window.axe.run('[data-presentation-root]')).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    results.push({ width, height, theme, overflow, completeJourney: true, manualChoicePreserved: true, completedQueueNeutral: true, finalCheckStartsAtTop: true, paginationDoesNotReset: true, mobileHierarchy: mobile ? 'example → category; category → queue; final → button only' : null, violations });
    await page.close();
  }
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, reducedMotion });
    await page.goto(`${after}/iframe.html?id=product-mobile-review-navigation--suggestions&viewMode=story`);
    await page.getByRole('heading', { name: 'AI suggestions' }).waitFor();
    await landing(page, 'category');
    // A taller header verifies that alignment is measured, not a fixed phone offset.
    await page.locator('.topbar').evaluate(el => { el.style.height = '104px'; });
    await page.getByRole('button', { name: /^Keep original text Keep the original/ }).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await startTrace(page);
    await page.getByRole('button', { name: /^Keep original text Keep the original/ }).click();
    await landing(page, 'category');
    const exampleTrace = await page.evaluate(() => window.reviewTrace);
    await page.getByRole('button', { name: /^Apply all suggested choices/ }).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await startTrace(page);
    await page.getByRole('button', { name: /^Apply all suggested choices/ }).click();
    await landing(page, 'queue');
    const categoryTrace = await page.evaluate(() => window.reviewTrace);
    const behavior = reducedMotion === 'reduce' ? 'instant' : 'smooth';
    assert.equal(exampleTrace.calls.at(-1).options.behavior, behavior);
    assert.equal(categoryTrace.calls.at(-1).options.behavior, behavior);
    assert.equal(await page.locator('.review-queue').evaluate(el => el.style.scrollMarginTop), '116px');
    if (reducedMotion === 'no-preference') {
      assert(new Set(exampleTrace.positions).size > 2);
      assert(new Set(categoryTrace.positions).size > 2);
    }
    results.push({ width: 390, height: 600, reducedMotion, reviewScrollBehavior: behavior, measuredHeader: 104, examplePositions: new Set(exampleTrace.positions).size, categoryPositions: new Set(categoryTrace.positions).size });
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
    }
    await chooseAppearance(page, 'dark');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `before-${story}-${width}-dark.png`), fullPage: true, animations: 'disabled' });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(out, 'report.json'), JSON.stringify({ synthetic: true, after, before, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
