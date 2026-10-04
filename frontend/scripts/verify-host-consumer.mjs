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
  await writeFile(path.join(host, 'index.html'), '<div id="root"></div><script type="module">if (new URLSearchParams(location.search).has("primitive")) import("/primitive.tsx"); else import("/main.tsx");</script>');
  await writeFile(path.join(host, 'host.css'), '.primary { background: rgb(1, 23, 45); border-radius: 3px; } .primary:hover:not(:disabled) { background: rgb(2, 34, 56); }');
  await writeFile(path.join(host, 'primitive.tsx'), `import React from 'react'; import { createRoot } from 'react-dom/client'; import { Button, PresentationRoot } from 'meowdiobooks-workflow-ui/ui'; import 'meowdiobooks-workflow-ui/product.css'; import './host.css'; createRoot(document.getElementById('root')!).render(<PresentationRoot><Button data-testid="consumer">Standalone consumer</Button></PresentationRoot>);`);
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
  await writeFile(path.join(host, 'assets.d.ts'), '/// <reference types="vite/client" />\ninterface Window { actionAttempted?: boolean; actionSettled?: boolean; hostActionCalls?: number }\n');
  await writeFile(path.join(host, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true, noEmit: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['*.tsx', '*.d.ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(host, 'tsconfig.json')], { cwd: host, stdio: 'pipe' });
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
  console.log(JSON.stringify({ packedFiles: packed.files.length, hostTypes: 'passed', equalSpecificityOverride: results, requiredActions: actionResults }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await new Promise(resolve => previewServer ? previewServer.httpServer.close(resolve) : resolve());
  await rm(host, { recursive: true, force: true });
}
