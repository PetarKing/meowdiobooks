/** Real shared UI with synthetic books; no backend or provider operations. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const [phase = 'after', url = 'http://127.0.0.1:5189/studio.html', out = '../docs/assets/review/mobile-steps-focus'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const results = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of [320, 390, 750, 1440]) for (const appearance of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}?appearance=${appearance}`);
      await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Preview' }).selectOption('dialogue');
      await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
      // Hide workshop controls from the evidence, after using them to prepare the real screen.
      await page.addStyleTag({ content: '.preview-controls { display:none !important; }' });
      const nav = page.getByRole('navigation', { name: 'Wizard stages' });
      const steps = nav.getByRole('button');
      const layout = await steps.evaluateAll(elements => elements.map(e => { const r=e.getBoundingClientRect(); return { text:e.textContent, x:r.x, width:r.width, height:r.height, right:r.right, disabled:e.disabled }; }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (phase === 'after') {
        assert(overflow <= 1, `Page overflow at ${width}: ${overflow}`);
        if (width <= 750) {
          assert.equal(await steps.count(), 6);
          for (const item of layout) { assert(item.width >= 44 && item.height >= 44, 'Touch target too small'); assert(item.x >= 0 && item.right <= width, 'Step outside viewport'); }
          assert(await page.getByRole('status', { name: 'Workflow progress' }).isVisible());
          assert.equal(await nav.evaluate(e => e.scrollWidth > e.clientWidth), false, 'Six steps must fit');
        } else assert.equal(await page.getByRole('status', { name: 'Workflow progress' }).isVisible(), false);
      }
      if (engine === chromium && [390,1440].includes(width)) {
        await page.screenshot({ path: `${out}/${phase}-steps-${width}-${appearance}.png` });
        if (width === 390) await page.screenshot({ path: `${out}/${phase}-steps-detail-${appearance}.png`, clip: {x:0,y:0,width,height:350} });
      }
      const trigger = page.getByRole('button', { name: 'About Dialogue' });
      // Keyboard opening reproduces the conspicuous X ring before the fix.
      await trigger.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Choose who reads each line.' });
      await dialog.waitFor();
      const close = page.getByRole('button', { name: 'Close phase guide' });
      const entry = await page.evaluate(() => ({ className:document.activeElement.className, outline:getComputedStyle(document.activeElement).outlineStyle }));
      if (phase === 'after') {
        assert(await dialog.evaluate(e => e === document.activeElement));
        assert.equal(entry.outline, 'none');
      }
      if (engine === chromium && width === 390 && appearance === 'light') await page.screenshot({ path: `${out}/${phase}-guide-390.png` });
      await page.keyboard.press('Tab');
      assert(await close.evaluate(e => e === document.activeElement));
      assert(await close.evaluate(e => e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'));
      await page.keyboard.press('Shift+Tab'); assert(await close.evaluate(e => e === document.activeElement));
      await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
      assert(await trigger.evaluate(e => e === document.activeElement));
      await trigger.click();
      if (phase === 'after') assert(await page.getByRole('dialog').evaluate(e => e === document.activeElement));
      await page.keyboard.press('Escape');
      if (phase === 'after') {
        // A previous enabled step remains navigable; future stages stay disabled.
        assert(await steps.nth(2).isDisabled());
        await steps.nth(0).click();
        assert.equal(await steps.nth(0).getAttribute('aria-current'), 'step');
        await steps.nth(1).click();
        assert.equal(await steps.nth(1).getAttribute('aria-current'), 'step');
      }
      assert.deepEqual(errors, []);
      results.push({ engine:engine.name(), width, appearance, overflow, layout, entry, keyboardTrap:true, escapeAndReturn:true });
      await page.close();
    }
  } finally { await browser.close(); }
}
await writeFile(`${out}/${phase}-report.json`, JSON.stringify(results,null,2));
console.log(`${phase}: ${results.length} browser/viewport/appearance cases passed`);
