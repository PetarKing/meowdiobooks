/** Render the real App with synthetic fixtures. Optional TYPOGRAPHY_SOURCE points to an archived frontend. */
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const source = await realpath(path.resolve(process.env.TYPOGRAPHY_SOURCE ?? root));
const output = path.resolve(process.argv[2] ?? '/tmp/typography-review');
await mkdir(output, { recursive: true });
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import App from ${JSON.stringify(`/@fs/${source}/src/App.tsx`)};
import i18n from ${JSON.stringify(`/@fs/${source}/src/i18n.ts`)};
import {createFixtureGateway,metadataFor} from ${JSON.stringify(`/@fs/${root}/design-kit/fixtures.ts`)};
import ${JSON.stringify(`/@fs/${source}/src/styles/product.css`)};
const params=new URLSearchParams(location.search), scenario=params.get('scenario')||'home';
await i18n.changeLanguage(params.get('locale')||'en');
window.typographyReview={metadata:metadataFor(scenario),t:key=>i18n.t(key)};
createRoot(document.getElementById('root')).render(React.createElement(App,{gateway:createFixtureGateway(scenario),appearance:params.get('appearance')||'light'}));
`;
const server = await createServer({
  root, configFile: false, cacheDir: path.join(output, '.vite'),
  plugins: [react(), {
    name: 'typography-review',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/typography?')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/typography', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/typography-entry.tsx"></script></body></html>'));
      });
    },
    resolveId(id) { if (id === '/typography-entry.tsx') return '\0typography-entry'; },
    load(id) { if (id === '\0typography-entry') return entry; },
  }],
  resolve: { alias: Object.fromEntries(['react', 'react-dom', 'i18next', 'react-i18next'].map(name => [name, path.join(root, 'node_modules', name)])) },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'i18next', 'react-i18next', 'three', 'three/addons/geometries/RoundedBoxGeometry.js'] },
  server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, source] } },
});
const cases = [];
for (const scenario of ['home', 'extract', 'cast-voices']) for (const width of [1440, 390]) for (const appearance of ['light', 'dark']) cases.push({ scenario, width, appearance, locale: 'en' });
for (const scenario of ['review', 'generate', 'export', 'library']) cases.push({ scenario, width: 1440, appearance: 'light', locale: 'en' });
for (const scenario of ['home', 'extract', 'cast-voices']) cases.push({ scenario, width: 390, appearance: 'light', locale: 'zh-CN' });
const crops = [
  { id: 'A-home-heart', scenario: 'home', selector: '.studio-hero-copy' },
  { id: 'B-serif-headings', scenario: 'cast-voices', selector: '.voice-stage-heading' },
  { id: 'C-sans-interface', scenario: 'extract', selector: '.extraction-choices' },
  { id: 'D-sans-reading', scenario: 'extract', selector: '.extracted' },
];
let browser;
const results = [];
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
  for (const test of cases) {
    const { scenario, width, appearance, locale } = test;
    const page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [], fontRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(request.failure()?.errorText));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); if (response.url().includes('.woff2')) fontRequests.push({ file: new URL(response.url()).pathname.split('/').pop(), status: response.status() }); });
    const name = `${scenario}-${width}-${appearance}-${locale}`;
    try {
      await page.goto(`http://127.0.0.1:${port}/typography?${new URLSearchParams({ scenario, appearance, locale })}`);
      await page.waitForFunction(() => window.typographyReview);
      const metadata = await page.evaluate(() => window.typographyReview.metadata);
      const translated = key => page.evaluate(key => window.typographyReview.t(key), key);
      if (metadata.story.surface === 'workflow') {
        await page.getByRole('button', { name: /Alice’s Adventures in Wonderland/ }).first().press('Enter');
        await page.getByRole('navigation', { name: await translated('Wizard stages') }).waitFor();
        if (metadata.story.acceptedStageLabel) await page.getByRole('button', { name: new RegExp('^' + await translated(metadata.story.acceptedStageLabel)) }).click();
        if (metadata.story.actions.includes('scan-review')) await page.getByRole('button', { name: new RegExp('^' + await translated('Scan for issues')) }).click();
        if (metadata.story.actions.includes('export')) await page.getByRole('button', { name: new RegExp('^' + await translated('Export')) }).first().click();
        await page.getByRole('heading', { name: await translated(metadata.story.heading), exact: true }).waitFor();
      } else if (metadata.story.surface === 'library') {
        await page.getByRole('button', { name: new RegExp('^' + await translated('Library')) }).click();
        await page.getByRole('heading', { name: await translated(metadata.story.heading), exact: true }).waitFor();
      } else await page.getByRole('button', { name: /Alice’s Adventures in Wonderland/ }).first().waitFor();
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
        window.scrollTo(0, 0);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
        samples: [...document.querySelectorAll('h1,.cast-roster-name,.extracted pre,.choice-title,.source-passage')].map(element => ({ text: element.textContent.slice(0, 70), font: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight })),
      }));
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      if (width === 1440 && appearance === 'light' && locale === 'en') {
        for (const crop of crops.filter(crop => crop.scenario === scenario)) {
          let clip = await page.locator(crop.selector).first().boundingBox();
          assert(clip, `Missing ${crop.selector}`);
          if (crop.id === 'B-serif-headings') {
            const card = await page.locator('.cast-roster-card').first().boundingBox();
            clip = { ...clip, width: card.width, height: card.y + card.height - clip.y };
          }
          if (crop.id === 'C-sans-interface') clip = { ...clip, width: Math.min(750, clip.width), height: clip.height + 8 };
          if (crop.id === 'D-sans-reading') clip = { ...clip, height: Math.max(clip.height, 165) };
          clip = { x: clip.x - 6, y: clip.y - 6, width: clip.width + 12, height: clip.height + 12 };
          await page.screenshot({ path: path.join(output, `${crop.id}.png`), clip });
        }
      }
      results.push({ ...test, errors, fontRequests, ...metrics });
      assert(metrics.overflow <= 1, `${name}: horizontal overflow ${metrics.overflow}`);
      assert.deepEqual(errors, [], name);
      assert(fontRequests.every(request => request.status === 200), `${name}: font download failed`);
      if (!process.env.TYPOGRAPHY_SOURCE && locale === 'en') {
        assert(metrics.fonts.some(font => font.family === 'Geist Sans' && font.status === 'loaded'), `${name}: Sans not loaded`);
        if (scenario === 'home') assert(metrics.fonts.some(font => font.family === 'Geist Serif Heart' && font.status === 'loaded'), `${name}: Heart not loaded`);
      }
      console.log('PASS', name);
    } finally { await page.close(); }
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ platform: process.platform, node: process.version, results }, null, 2));
  await browser?.close();
  await server.close();
}
