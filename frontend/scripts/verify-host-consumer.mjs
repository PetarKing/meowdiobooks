/** Exercise the packed public package from a separate, disposable host project. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = await realpath(await mkdtemp(path.join(os.tmpdir(), 'meowdiobooks-host-')));
let browser;
let server;
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--cache', path.join(host, '.npm-cache'), '--pack-destination', host], { cwd: root, encoding: 'utf8' }))[0];
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
  await writeFile(path.join(host, 'index.html'), '<div id="root"></div><script type="module">import(new URLSearchParams(location.search).has("primitive") ? "/primitive.tsx" : "/main.tsx");</script>');
  await writeFile(path.join(host, 'host.css'), '.primary { background: rgb(1, 23, 45); border-radius: 3px; } .primary:hover:not(:disabled) { background: rgb(2, 34, 56); }');
  await writeFile(path.join(host, 'primitive.tsx'), `import React from 'react'; import { createRoot } from 'react-dom/client'; import { Button, PresentationRoot } from 'meowdiobooks-workflow-ui/ui'; import 'meowdiobooks-workflow-ui/product.css'; import './host.css'; createRoot(document.getElementById('root')!).render(<PresentationRoot><Button data-testid="consumer">Standalone consumer</Button></PresentationRoot>);`);
  await writeFile(path.join(host, 'main.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from 'meowdiobooks-workflow-ui';
import { HttpWizardApi } from 'meowdiobooks-workflow-ui/api';
import { Button, PresentationRoot } from 'meowdiobooks-workflow-ui/ui';
import 'meowdiobooks-workflow-ui/i18n';
import 'meowdiobooks-workflow-ui/product.css';
import './host.css';
import { hostComposition } from './hostCompatibility';
class Gateway extends HttpWizardApi {
  async listBooks() { return []; }
  async listLibrary() { return []; }
}
createRoot(document.getElementById('root')!).render(<App {...hostComposition} gateway={new Gateway()} renderHeader={() => <Button data-testid="consumer">Host header</Button>} />);
`);
  await writeFile(path.join(host, 'assets.d.ts'), '/// <reference types="vite/client" />\n');
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
    assert.equal(baseline, 'rgb(237, 102, 89)', 'Canonical product CSS must supply accepted-main primary styling');
    await button.hover();
    const hover = await button.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(hover, 'rgb(2, 34, 56)', 'An equal-specificity host hover rule must also win');
    assert.deepEqual(errors, []);
    results.push({ consumer: primitive ? 'standalone primitive' : 'App host header', ...actual, baseline, hover, errors });
    await page.close();
  }
  console.log(JSON.stringify({ packedFiles: packed.files.length, hostTypes: 'passed', equalSpecificityOverride: results }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(host, { recursive: true, force: true });
}
