/** Exercise the packed public package from a separate, disposable host project. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = await realpath(await mkdtemp(path.join(os.tmpdir(), 'meowdiobooks-host-')));
let browser;
let server;
let previewServer;
try {
  let packageRoot = root;
  // Reproduce an exact pre-fix candidate with the same real consumer when requested.
  if (process.env.WORKFLOW_CONSUMER_REF) {
    packageRoot = path.join(host, 'package-source');
    await mkdir(packageRoot);
    const archive = path.join(host, 'reference.tar');
    execFileSync('git', ['archive', '--output', archive, process.env.WORKFLOW_CONSUMER_REF, 'frontend'], { cwd: path.dirname(root) });
    execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', packageRoot]);
  }
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--cache', path.join(host, '.npm-cache'), '--pack-destination', host], { cwd: packageRoot, encoding: 'utf8' }))[0];
  assert(!packed.files.some(({ path: name }) => /(?:storybook|stories|design-kit|\.test\.|persimmon)/i.test(name)), 'Package includes development or rejected design files');
  await mkdir(path.join(host, 'node_modules/meowdiobooks-workflow-ui'), { recursive: true });
  execFileSync('tar', ['-xzf', path.join(host, packed.filename), '--strip-components=1', '-C', path.join(host, 'node_modules/meowdiobooks-workflow-ui')]);
  for (const name of await readdir(path.join(root, 'node_modules'))) {
    if (name === 'meowdiobooks-workflow-ui' || name.startsWith('.')) continue;
    await symlink(path.join(root, 'node_modules', name), path.join(host, 'node_modules', name));
  }
  await writeFile(path.join(host, 'package.json'), JSON.stringify({ type: 'module', private: true }));
  const contract = (await readFile(path.join(root, 'src/test/hostCompatibility.tsx'), 'utf8'))
    .replace("from '../App'", "from 'meowdiobooks-workflow-ui'")
    .replace("from '../locales/edition'", "from 'meowdiobooks-workflow-ui/i18n'");
  await writeFile(path.join(host, 'hostCompatibility.tsx'), contract);
  await writeFile(path.join(host, 'index.html'), '<div id="root"></div><script type="module">if (new URLSearchParams(location.search).has("primitive")) import("/primitive.tsx"); else if (new URLSearchParams(location.search).has("handoff")) import("/handoff.tsx"); else if (new URLSearchParams(location.search).has("modal")) import("/modal.tsx"); else import("/main.tsx");</script>');
  await writeFile(path.join(host, 'host.css'), '.primary { background: rgb(1, 23, 45); border-radius: 3px; } .primary:hover:not(:disabled) { background: rgb(2, 34, 56); }');
  await writeFile(path.join(host, 'primitive.tsx'), `import React from 'react'; import { createRoot } from 'react-dom/client'; import { Button, PresentationRoot } from 'meowdiobooks-workflow-ui/ui'; import 'meowdiobooks-workflow-ui/product.css'; import './host.css'; createRoot(document.getElementById('root')!).render(<PresentationRoot><Button data-testid="consumer">Standalone consumer</Button></PresentationRoot>);`);
  await writeFile(path.join(host, 'modal.tsx'), `
import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
import { DialogBackdrop, DialogSurface, PresentationRoot, Button } from 'meowdiobooks-workflow-ui/ui';
import 'meowdiobooks-workflow-ui/product.css';
function ModalHost() {
  const [open, setOpen] = useState(false); const [nested, setNested] = useState(false);
  return <PresentationRoot appearance={new URLSearchParams(location.search).get('appearance') === 'dark' ? 'dark' : 'light'} palette={{ paper: '#fdfdf4' }}>
    <div style={{ transform: 'translateZ(0)', position: 'relative', zIndex: 1 }}>
      <header style={{ position: 'fixed', top: 0, height: 70, width: '100%', zIndex: 99999 }}>Host header</header>
      <main style={{ minHeight: 2400, paddingTop: 560 }}><Button onClick={() => setOpen(true)}>Open decision</Button></main>
      <footer style={{ position: 'fixed', bottom: 0, height: 70, width: '100%', zIndex: 99999 }}>Host footer</footer>
      {open && <DialogBackdrop><DialogSurface aria-label="Critical decision" className="dialog-card" onDismiss={() => setOpen(false)}>
        <h2>Review this decision</h2><Button onClick={() => setNested(true)}>Open nested confirmation</Button>
        {Array.from({ length: 30 }, (_, i) => <p key={i}>Long review content {i}</p>)}
        <Button onClick={() => setOpen(false)}>Keep reviewing</Button>
        {nested && <DialogBackdrop><DialogSurface aria-label="Nested confirmation" className="dialog-card" onDismiss={() => setNested(false)}><Button onClick={() => setNested(false)}>Back to decision</Button></DialogSurface></DialogBackdrop>}
      </DialogSurface></DialogBackdrop>}
    </div>
  </PresentationRoot>;
}
createRoot(document.getElementById('root')!).render(<ModalHost />);
`);
  await writeFile(path.join(host, 'handoff.tsx'), `
import React, { useCallback, useRef, useState } from 'react'; import { createRoot } from 'react-dom/client';
import App from 'meowdiobooks-workflow-ui';
import { HttpWizardApi } from 'meowdiobooks-workflow-ui/api';
import type { Job, WizardSnapshot } from 'meowdiobooks-workflow-ui/contracts';
import { DialogBackdrop, DialogSurface, PresentationRoot } from 'meowdiobooks-workflow-ui/ui';
import 'meowdiobooks-workflow-ui/i18n'; import 'meowdiobooks-workflow-ui/product.css';
let blocked = false;
Object.assign(window, { finishFundingHandoff: () => { blocked = true; } });
const snapshot: WizardSnapshot = {
 book: { id: 'host-book', title: 'Host handoff', author: '', filename: 'synthetic.pdf', pageCount: 1, completedStages: ['import'] },
 activeArtifacts: {}, warnings: [], boundaryCandidates: [], reviewInspection: { decisions: [], boundaryDecisions: [], consequences: {}, history: [] }, chapters: [], generatedChapters: [], history: {},
 voiceModels: [], voiceSelection: { modelId: '', language: 'english' }
};
class HandoffGateway extends HttpWizardApi {
 async listBooks() { return []; } async listLibrary() { return []; } async listBookJobs() { return []; }
 async getBookSnapshot() { return snapshot; } async getRepresentativePages() { return []; }
 async previewExtraction() { return { page: 1, pageCount: 1, method: 'liteparse' as const, text: 'Synthetic source', warnings: [], elapsedSeconds: 0, cached: true, imageUrl: '' }; }
 async getJob(): Promise<Job> { return { id: 'host-job', kind: 'v2:extract', status: blocked ? 'failed' : 'running', payload: { book_id: 'host-book' }, progress: 30, message: 'Core processing', ...(blocked ? { error: 'Funding required', action_required: { code: 'HOST_FUNDING_REQUIRED', message: 'Funding required', context: {} } } : {}) }; }
}
const gateway = new HandoffGateway();
const locationHint = { bookId: 'host-book', stepId: 'extract', activeJobId: 'host-job' };
function FundingHost() {
 const [funding, setFunding] = useState(false); const returnFocus = useRef<HTMLButtonElement>(null);
 const onActionRequired = useCallback(() => { setFunding(true); return true; }, []);
 return <><App gateway={gateway} initialWorkflowLocation={locationHint} onActionRequired={onActionRequired}
   renderHeader={() => <button ref={returnFocus}>Host account</button>} />
   {funding && <PresentationRoot appearance="dark"><DialogBackdrop><DialogSurface aria-label="Host funding handoff" className="dialog-card" returnFocusRef={returnFocus} onDismiss={() => setFunding(false)}><h2>Funding required</h2><button onClick={() => setFunding(false)}>Keep reviewing</button></DialogSurface></DialogBackdrop></PresentationRoot>}
 </>;
}
createRoot(document.getElementById('root')!).render(<FundingHost />);
`);
  await writeFile(path.join(host, 'main.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from 'meowdiobooks-workflow-ui';
import { ActionRequiredError, HttpWizardApi } from 'meowdiobooks-workflow-ui/api';
import { Button, PresentationRoot } from 'meowdiobooks-workflow-ui/ui';
import 'meowdiobooks-workflow-ui/i18n';
import 'meowdiobooks-workflow-ui/product.css';
import './host.css';
import { hostComposition } from './hostCompatibility';
class Gateway extends HttpWizardApi {
  async listBooks() { return []; }
  async listLibrary() { return []; }
  async getBookSnapshot(): Promise<never> {
    window.actionAttempted = true;
    setTimeout(() => { window.actionSettled = true; }, 0);
    throw new ActionRequiredError({ code: 'HOST_REVIEW_REQUIRED', message: 'Expected host review action', context: { bookId: 'book', stage: 'dialogue' } }, { handled: new URLSearchParams(location.search).get('action') === 'handled' });
  }
}
const actionMode = new URLSearchParams(location.search).get('action');
createRoot(document.getElementById('root')!).render(<App {...hostComposition} gateway={new Gateway()} initialWorkflowLocation={actionMode ? { bookId: 'book', stepId: 'dialogue' } : undefined} onActionRequired={() => { window.hostActionCalls = (window.hostActionCalls || 0) + 1; return actionMode === 'delegated'; }} renderHeader={() => <Button data-testid="consumer">Host header</Button>} />);
`);
  await writeFile(path.join(host, 'assets.d.ts'), '/// <reference types="vite/client" />\ninterface Window { actionAttempted?: boolean; actionSettled?: boolean; hostActionCalls?: number; finishFundingHandoff?: () => void }\n');
  await writeFile(path.join(host, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true, noEmit: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['*.tsx', '*.d.ts'] }));
  try {
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(host, 'tsconfig.json')], { cwd: host, stdio: 'pipe' });
  } catch (error) {
    console.error(error.stdout?.toString());
    throw error;
  }
  server = await createServer({ configFile: false, root: host, plugins: [react()], esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react-i18next', 'i18next'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch();
  const results = [];
  for (const primitive of [true, false]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(`http://127.0.0.1:${address.port}/${primitive ? '?primitive' : ''}`);
    const button = page.getByTestId('consumer');
    await button.waitFor();
    // Headless platforms may initially place the pointer over the top-left control.
    await page.mouse.move(1000, 600);
    assert.equal(await button.evaluate(element => element.matches(':hover')), false);
    // Measure cascade endpoints, not a transient colour during stylesheet loading.
    const actual = await button.evaluate(element => {
      element.style.transition = 'none';
      return { background: getComputedStyle(element).backgroundColor, radius: getComputedStyle(element).borderRadius };
    });
    assert.deepEqual(actual, { background: 'rgb(1, 23, 45)', radius: '3px' });
    const baseline = await button.evaluate(element => {
      const override = [...document.querySelectorAll('style')].find(style => style.dataset.viteDevId?.endsWith('/host.css'));
      if (!override?.sheet) throw new Error('Host CSS was not loaded');
      element.style.transition = 'none';
      override.sheet.disabled = true;
      const background = getComputedStyle(element).backgroundColor;
      override.sheet.disabled = false;
      return background;
    });
    assert.equal(baseline, 'rgb(164, 47, 77)', 'Canonical product CSS must supply canonical primary styling');
    await button.hover();
    const hover = await button.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(hover, 'rgb(2, 34, 56)', 'An equal-specificity host hover rule must also win');
    assert.deepEqual(errors, []);
    results.push({ consumer: primitive ? 'standalone primitive' : 'App host header', ...actual, baseline, hover, errors });
    await page.close();
  }
  const modalResults = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 480 }]) {
    for (const appearance of ['light', 'dark']) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/?modal&appearance=${appearance}`);
      const opener = page.getByRole('button', { name: 'Open decision', exact: true });
      await opener.waitFor();
      await page.evaluate(() => window.scrollTo(0, 500));
      const before = await page.evaluate(() => window.scrollY);
      const gutterBefore = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'Critical decision', exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.evaluate(element => element === document.activeElement), true);
      const geometry = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        const backdrop = element.parentElement;
        const inspect = node => node ? {
          tag: node.tagName, id: node.id, classes: node.className, inert: node.hasAttribute('inert'),
          box: node.getBoundingClientRect().toJSON(),
          styles: Object.fromEntries(['position', 'inset', 'zIndex', 'display', 'visibility', 'pointerEvents', 'transform', 'overflow', 'scrollbarGutter', 'height', 'width'].map(key => [key, getComputedStyle(node)[key]])),
        } : null;
        const corners = [[0, 0], [innerWidth - 1, 0], [0, innerHeight - 1], [innerWidth - 1, innerHeight - 1]].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return { x, y, covered: Boolean(hit?.closest('.dialog-portal')), hit: inspect(hit) };
        });
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: box.height,
          maxHeight: getComputedStyle(element).maxHeight, scrollHeight: element.scrollHeight,
          appearance: backdrop.dataset.appearance, paper: getComputedStyle(element).backgroundColor,
          bodyTop: document.body.style.top, rootOverflow: document.documentElement.style.overflow, rootScrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
          cornersCovered: corners.every(corner => corner.covered),
          coverageDiagnostic: { backdrop: inspect(backdrop), body: inspect(document.body), root: inspect(document.documentElement), corners, viewport: { innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, scrollX, scrollY, devicePixelRatio } } };
      });
      assert(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= viewport.width && geometry.bottom <= viewport.height, 'Dialog must fit complete viewport');
      assert(geometry.scrollHeight > geometry.height, 'Tall decision must retain internal scrolling');
      if (!geometry.cornersCovered) console.error(JSON.stringify({ failure: 'modal viewport coverage', viewport, appearance, before, geometry, errors }, null, 2));
      assert(geometry.cornersCovered, 'Shell header/footer must never peek through backdrop');
      assert.equal(geometry.rootOverflow, 'hidden');
      assert.equal(geometry.rootScrollbarGutter, 'auto', 'Modal must release the stable scrollbar gutter on every platform');
      assert.equal(geometry.bodyTop, `${-before}px`);
      assert.equal(geometry.appearance, appearance);
      assert.equal(geometry.paper, 'rgb(253, 253, 244)', 'Portal must retain semantic host palette');
      await page.mouse.move(2, 2);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Backdrop wheel must not scroll document');
      await dialog.hover();
      await page.mouse.wheel(0, 600);
      await page.waitForFunction(() => document.querySelector('[aria-label="Critical decision"]').scrollTop > 0);
      const internalScroll = await dialog.evaluate(element => element.scrollTop);
      await dialog.evaluate(element => element.scrollTop = 0);
      await page.getByRole('button', { name: 'Open nested confirmation' }).click();
      const nested = page.getByRole('dialog', { name: 'Nested confirmation' });
      await nested.waitFor();
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'Back to decision' }).evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Escape');
      await nested.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('button', { name: 'Open nested confirmation' }).evaluate(element => document.activeElement === element), true);
      assert.equal(await page.evaluate(() => document.body.style.position), 'fixed', 'Nested dismissal must retain page lock');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.scrollY), before, 'Final dismissal must restore document position');
      assert.equal(await opener.evaluate(element => document.activeElement === element), true);
      assert.deepEqual(errors, []);
      const { coverageDiagnostic, ...measuredGeometry } = geometry;
      modalResults.push({ viewport, appearance, before, gutterBefore, internalScroll, geometry: measuredGeometry, errors });
      await page.close();
    }
  }
  const handoffResults = [];
  async function checkModalHandoff(base, mode) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/?handoff`);
      await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Core processing' }) }).waitFor();
      const before = await page.evaluate(() => ({ position: document.body.style.position, overflow: document.documentElement.style.overflow }));
      assert.deepEqual(before, { position: 'fixed', overflow: 'hidden' });
      await page.evaluate(() => window.finishFundingHandoff());
      const funding = page.getByRole('dialog', { name: 'Host funding handoff' });
      await funding.waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some(element => element.textContent.includes('Core processing')));
      const after = await funding.evaluate(element => ({ position: document.body.style.position, overflow: document.documentElement.style.overflow, focused: element.contains(document.activeElement), inert: Boolean(element.closest('[inert]')) }));
      assert.deepEqual(after, { position: 'fixed', overflow: 'hidden', focused: true, inert: false }, 'Core cleanup must retain hosted modal ownership across App and /ui bundles');
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'Keep reviewing' }).evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Escape');
      await funding.waitFor({ state: 'detached' });
      const closed = await page.evaluate(() => ({ position: document.body.style.position, overflow: document.documentElement.style.overflow, focus: document.activeElement.textContent }));
      assert.deepEqual(closed, { position: '', overflow: '', focus: 'Host account' });
      assert.deepEqual(errors, []);
      handoffResults.push({ mode, viewport, before, after, closed, errors });
      await page.close();
    }
  }
  await checkModalHandoff(`http://127.0.0.1:${address.port}`, 'development');
  const actionResults = [];
  async function checkRequiredActions(base, mode) {
    for (const action of ['handled', 'delegated', 'declined']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(`${mode}: ${error.message}`); });
      await page.goto(`${base}/?action=${action}`);
      await page.waitForFunction(() => window.actionSettled).catch(async error => {
        console.error(JSON.stringify({ mode, action, errors, body: await page.locator('body').innerText() }));
        throw error;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const alerts = await page.getByRole('alert').allTextContents();
      const calls = await page.evaluate(() => window.hostActionCalls || 0);
      assert.equal(alerts.some(text => text.includes('Expected host review action')), action === 'declined', `${mode}: ${action} expected-action visibility`);
      assert.equal(calls, action === 'handled' ? 0 : 1, `${mode}: ${action} host handling`);
      assert.deepEqual(errors, []);
      actionResults.push({ mode, action, alerts, calls, errors });
      await page.close();
    }
  }
  await checkRequiredActions(`http://127.0.0.1:${address.port}`, 'development');
  await build({ configFile: false, root: host, plugins: [react()], esbuild: { jsx: 'automatic' }, logLevel: 'error' });
  previewServer = await preview({ configFile: false, root: host, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const previewAddress = previewServer.httpServer.address();
  await checkRequiredActions(`http://127.0.0.1:${previewAddress.port}`, 'production');
  await checkModalHandoff(`http://127.0.0.1:${previewAddress.port}`, 'production');
  console.log(JSON.stringify({ packedFiles: packed.files.length, hostTypes: 'passed', equalSpecificityOverride: results, requiredActions: actionResults, modalIsolation: modalResults, crossEntryModalHandoff: handoffResults }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await new Promise(resolve => previewServer ? previewServer.httpServer.close(resolve) : resolve());
  await rm(host, { recursive: true, force: true });
}
