/** Capture the actual product and primitive stories, including failure states. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:6006';
const output = path.resolve(process.argv[3] ?? '/tmp/meowdiobooks-design-review');
const filter = process.argv[4] ? new RegExp(process.argv[4]) : /^(product-accepted-baseline|components-[a-z-]+)--/;
const locale = process.argv[5] ?? 'en';
const appearance = process.argv[6] ?? 'light';
const viewports = process.env.DESIGN_REVIEW_VIEWPORTS ? process.env.DESIGN_REVIEW_VIEWPORTS.split(',').map(size => {
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) throw new Error(`Invalid review viewport: ${size}`);
  return { width, height };
}) : [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const index = await (await fetch(`${base}/index.json`)).json();
const entries = Object.values(index.entries).filter(entry => entry.type === 'story' && filter.test(entry.id));
if (!entries.length) throw new Error('No matching stories; check the preview URL and filter.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const viewport of viewports) {
    for (const entry of entries) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      const result = { story: entry.id, name: entry.name, locale, appearance, viewport, errors };
      try {
        await page.goto(`${base}/iframe.html?id=${entry.id}&viewMode=story&appearance=${appearance}`);
        if (entry.id.startsWith('product-accepted-baseline--')) {
          await page.waitForSelector('[data-scenario-ready]', { timeout: 30000 });
        } else {
          await page.waitForSelector('#storybook-root [data-presentation-root]', { timeout: 30000 });
        }
        if (locale === 'zh-CN') {
          if (await page.getByRole('dialog').count()) {
            await page.evaluate(async () => (await import('/src/i18n.ts')).changeAppLocale('zh-CN'));
          } else await page.getByRole('button', { name: 'Switch interface to Simplified Chinese' }).click();
          await page.waitForFunction(() => document.querySelector('.language-toggle button[aria-pressed="true"]')?.textContent === '中文');
        }
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
        await page.mouse.move(viewport.width - 2, viewport.height - 2);
        // Scenario entry moves focus and scrolls. Resting renders start at the top.
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        result.horizontalOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
        result.imageFailures = await page.evaluate(() => [...document.images].filter(image => image.complete && image.naturalWidth === 0).map(image => ({ alt: image.alt, src: image.currentSrc.slice(0, 200) })));
        await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
        result.violations = await page.evaluate(async () => {
          // A story's own final a11y assertion may still be finishing.
          for (let attempt = 0; attempt < 12; attempt++) {
            try {
              return (await window.axe.run('#storybook-root')).violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
            } catch (error) {
              if (!String(error).includes('Axe is already running') || attempt === 11) throw error;
              await new Promise(resolve => setTimeout(resolve, 250));
            }
          }
        });
        result.screenshot = `${entry.id}-${viewport.width}.png`;
        await page.screenshot({ path: path.join(output, result.screenshot), fullPage: true, animations: 'disabled' });
        const inspector = page.locator('[role="dialog"].cast-inspector');
        if (await inspector.count()) {
          const scrollable = await inspector.first().evaluate(element => element.scrollHeight > element.clientHeight + 40);
          if (scrollable) {
            await inspector.first().evaluate(element => { element.scrollTop = element.scrollHeight; });
            result.inspectorBottomScreenshot = `${entry.id}-${viewport.width}-inspector-bottom.png`;
            await page.screenshot({ path: path.join(output, result.inspectorBottomScreenshot), animations: 'disabled' });
          }
        }
        // A readable fallback is intentional in the missing-cover scenario.
        result.passed = errors.length === 0 && result.horizontalOverflow <= 1 && result.violations.length === 0;
      } catch (error) {
        result.passed = false;
        errors.push(error.message);
        await page.screenshot({ path: path.join(output, `${entry.id}-${viewport.width}-error.png`), fullPage: true });
      }
      results.push(result);
      await writeFile(path.join(output, 'report.json'), JSON.stringify({ preview: base, locale, generatedAt: new Date().toISOString(), results }, null, 2));
      console.log(`${result.passed ? 'PASS' : 'REVIEW'} ${entry.id} ${viewport.width}${result.horizontalOverflow > 1 ? ` overflow=${result.horizontalOverflow}` : ''} axe=${result.violations?.length ?? '?'} errors=${errors.length}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (results.some(result => !result.passed)) process.exitCode = 1;
