import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.argv[2] || 'http://127.0.0.1:5198';
const out = process.env.THEME_EVIDENCE_DIR || '/private/tmp/meowdiobooks-theme-expiry-check';
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><body><div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {useAppearance} from '/src/app/useAppearance.ts';import {ThemeToggle} from '/src/components/ThemeToggle.tsx';import {PresentationRoot} from '/src/components/PresentationRoot.tsx';import '/src/i18n.ts';import '/src/styles/product.css';function Probe(){const {appearance,resolvedAppearance,setAppearance}=useAppearance();return React.createElement(PresentationRoot,{appearance:resolvedAppearance},React.createElement('output',{'data-mode':appearance},resolvedAppearance),React.createElement(ThemeToggle,{appearance,onChange:setAppearance}))}ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Probe));</script></body></html>`;
const report = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });
    await context.route('**/theme-expiry-check.html', route => route.fulfill({ contentType: 'text/html', body: html }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    const now = new Date('2026-10-04T12:00:00Z');
    await page.clock.install({ time: now });
    await page.goto(origin + '/theme-expiry-check.html');
    const mode = page.locator('output');
    await mode.filter({ hasText: 'dark' }).waitFor().catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
    assert.equal(await mode.getAttribute('data-mode'), 'system');
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await mode.filter({ hasText: 'light' }).waitFor();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('meowdiobooks.appearance')));
    assert(saved.expiresAt > now.getTime() && saved.expiresAt <= now.getTime() + 12 * 60 * 60 * 1000 + 5000);
    await page.reload(); await mode.filter({ hasText: 'light' }).waitFor();
    assert.equal(await mode.getAttribute('data-mode'), 'light');
    const other = await context.newPage(); await other.clock.install({ time: new Date(await page.evaluate(() => Date.now())) });
    await other.goto(origin + '/theme-expiry-check.html');
    await other.locator('output').filter({ hasText: 'light' }).waitFor();
    await other.getByRole('button', { name: 'Toggle dark mode' }).click();
    await mode.filter({ hasText: 'dark' }).waitFor();
    assert.equal(await mode.getAttribute('data-mode'), 'dark');
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await mode.filter({ hasText: 'light' }).waitFor();
    await page.clock.fastForward(12 * 60 * 60 * 1000 + 5000);
    await mode.filter({ hasText: 'dark' }).waitFor();
    assert.equal(await mode.getAttribute('data-mode'), 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await mode.filter({ hasText: 'light' }).waitFor();
    await page.reload(); await mode.filter({ hasText: 'light' }).waitFor();
    assert.equal(await mode.getAttribute('data-mode'), 'system');
    assert.deepEqual(errors, []);
    report.push({ engine: engine.name(), result: 'passed', scenarios: ['device default', '12-hour manual persistence', 'reload', 'cross-tab changes', 'live expiry', 'live device change', 'expired reload'] });
    console.log(engine.name() + ': theme expiry passed');
  } finally { await browser.close(); }
}
await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
