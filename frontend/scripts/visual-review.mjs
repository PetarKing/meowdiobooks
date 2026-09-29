/** Render the canonical release candidate in both appearances on desktop and phone. */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'storybook-static');
const out = path.resolve(process.argv[2] ?? '/tmp/meowdiobooks-visual-review');
const cases = ['home', 'library', 'library-empty', 'library-error', 'library-refresh-error',
  'extract', 'dialogue', 'dialogue-results', 'dialogue-running', 'review', 'review-final',
  'review-recovery', 'cast-identities', 'cast-review-states', 'cast-voice-review-states',
  'cast-inspector', 'cast-voices-dense', 'generate', 'generate-long-book', 'generate-running',
  'generate-failed', 'export', 'export-long-book', 'phase-help'];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const index = JSON.parse(await readFile(path.join(site, 'index.json'), 'utf8'));
for (const id of cases) {
  if (!index.entries[`product-accepted-baseline--${id}`]) throw new Error(`Missing release scenario: ${id}`);
}
await mkdir(out, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const filename = path.resolve(site, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!filename.startsWith(site + path.sep)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
const results = [];
let browser;
try {
  browser = await chromium.launch();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    for (const appearance of ['light', 'dark']) {
      for (const id of cases) {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        let result = { scenario: id, appearance, width: viewport.width, passed: false, errors };
        try {
          await page.goto(`http://127.0.0.1:${port}/iframe.html?id=product-accepted-baseline--${id}&viewMode=story&appearance=${appearance}`);
          await page.waitForSelector(`[data-scenario-ready="${id}"]`, { timeout: 30000 });
          await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
          const violations = await page.evaluate(async () => (await window.axe.run('#storybook-root')).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })));
          result = { ...result, overflow, violations, passed: errors.length === 0 && overflow <= 1 && violations.length === 0 };
        } catch (error) { errors.push(error.message); }
        await page.screenshot({ path: path.join(out, `${id}-${viewport.width}-${appearance}.png`), fullPage: true, animations: 'disabled' });
        results.push(result);
        await writeFile(path.join(out, 'report.json'), JSON.stringify({ cases, results }, null, 2));
        console.log(`${result.passed ? 'PASS' : 'FAIL'} ${id} ${viewport.width} ${appearance}`);
        await page.close();
      }
    }
  }
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
