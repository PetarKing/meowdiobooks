/** Synthetic production sidebar checks. No live gateway or manuscript data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseAppearance } from './appearance-controls.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:6017';
const out = path.resolve(process.argv[3] ?? '.review-evidence/sidebar');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  for (const [width, height] of [[390, 844], [768, 1024], [834, 1112], [1440, 820], [1440, 560]]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
    await page.goto(`${url}/iframe.html?id=product-workflow-sidebar--playground&viewMode=story`);
    const nav = page.getByRole('navigation', { name: 'Wizard stages' });
    const review = nav.getByRole('button', { name: /^Review / });
    await review.waitFor();
    assert.equal(await page.locator('.local-pill').count(), 0, 'Core header omits the execution badge by default');
    await chooseAppearance(page, theme);
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    assert.equal(await review.getAttribute('aria-current'), 'step');
    assert(await nav.getByRole('button', { name: /^Cast & voices / }).isDisabled());
    const marker = review.locator('b');
    if (width <= 750) {
      assert.equal(await page.getByRole('button', { name: 'Collapse sidebar' }).isVisible(), false);
      assert.equal(await page.locator('.rail-tools').isVisible(), false);
      assert.notEqual(await marker.evaluate(el => getComputedStyle(el).fontSize), '0px');
      assert(!await marker.evaluate(el => getComputedStyle(el, '::before').content.includes('♥')));
    } else {
      assert.equal(await marker.evaluate(el => getComputedStyle(el, '::before').content), '"♥"');
      assert.equal(await marker.evaluate(el => getComputedStyle(el, '::before').fontSize), '18px');
      assert.equal(await marker.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      await page.locator('.rail').screenshot({ path: path.join(out, `sidebar-${width}-${height}-${theme}.png`) });
      const beforeName = await review.getAttribute('aria-label');
      const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
      const railRect = await page.locator('.rail').boundingBox();
      const toggleRect = await toggle.boundingBox();
      assert(toggleRect.x >= railRect.x && toggleRect.x + toggleRect.width <= railRect.x + railRect.width, 'Toggle stays inside sidebar');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Expand sidebar' }).waitFor();
      await settle(page);
      assert.equal(await review.getAttribute('aria-current'), 'step');
      assert.equal(await review.getAttribute('aria-label'), beforeName);
      assert.equal(await page.evaluate(() => localStorage.getItem('meowdiobooks.sidebarCollapsed')), 'true');
      await page.locator('.rail').screenshot({ path: path.join(out, `sidebar-${width}-${height}-${theme}-collapsed.png`) });
      const extract = nav.getByRole('button', { name: /^Extract / });
      await extract.click();
      assert.equal(await extract.getAttribute('aria-current'), 'step');
      assert.equal(await extract.locator('b').evaluate(el => getComputedStyle(el, '::before').content), '"♥"', 'Selected completed step uses the same current-step heart');
      await settle(page);
      const draftColor = await marker.evaluate(el => {
        const probe = document.createElement('span'); probe.style.color = 'var(--warning-ink)'; el.append(probe);
        const color = getComputedStyle(probe).color; probe.remove(); return color;
      });
      assert.equal(await marker.evaluate(el => getComputedStyle(el).color), draftColor, 'Inactive draft retains its amber marker');
      assert.equal(await review.locator('small').evaluate(el => getComputedStyle(el).color), draftColor);
      assert.equal(await review.getAttribute('aria-current'), null);
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await settle(page);
      if (width === 1440 && height === 820) await page.locator('.rail').screenshot({ path: path.join(out, `draft-away-${theme}.png`) });
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await review.click();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await settle(page);
      assert.equal(await review.getAttribute('aria-current'), 'step');
      assert.equal(await page.evaluate(() => localStorage.getItem('meowdiobooks.sidebarCollapsed')), 'false');
      assert.equal(await extract.locator('b').textContent(), '✓');
      if (width === 834) {
        await page.getByRole('button', { name: 'Switch interface to Simplified Chinese' }).click();
        assert(await page.locator('.rail-tools-label').textContent() === '制作流程');
        assert(await page.getByRole('button', { name: '收起侧栏' }).isVisible());
        await page.locator('.rail').screenshot({ path: path.join(out, `sidebar-${width}-${theme}-zh.png`) });
      }
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.addScriptTag({ path: fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)) });
    const violations = await page.evaluate(async () => (await window.axe.run('#wizard-sidebar')).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    results.push({ width, height, theme, heart: width > 750, phoneProgressPreserved: width <= 750, keyboardCollapse: width > 750, navigationPreserved: true, inactiveDraftCue: width > 750, defaultBadgeHidden: true, violations });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(out, 'report.json'), JSON.stringify({ synthetic: true, url, results }, null, 2));
console.log(`Passed ${results.length} sidebar viewport/theme checks`);
