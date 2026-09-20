/** Compare actual accepted git source and working source using identical story fixtures. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] ?? 'd3855c3bb921d654aae02bb28fa3858a7e01b86c';
const out = path.resolve(process.argv[3] ?? '/tmp/meowdiobooks-visual-parity');
const baseline = await mkdtemp(path.join(root, '.parity-'));
const servers = [];
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const port = server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error ? reject(error) : resolve()));
  return port;
}
const acceptedPort = await unusedPort();
let candidatePort = await unusedPort();
while (candidatePort === acceptedPort) candidatePort = await unusedPort();
let cases = ['home','import','home-error','delete-dialog','library','library-empty','library-error','extract','dialogue','dialogue-results','review','review-final','cast-identities','cast-voices','cast-inspector','generate','export','export-long-book'];
await mkdir(out, { recursive: true });
let browser;
try {
  const archive = execFileSync('git', ['archive', ref, 'frontend/src'], { cwd: path.dirname(root), maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-x', '--strip-components=1', '-C', baseline], { input: archive });
  await mkdir(path.join(baseline, 'src/styles'), { recursive: true });
  await writeFile(path.join(baseline,'src/styles/product.css'), '@import "../styles.css";\n@import "../media.css";\n');
  for (const [label, port, source] of [['accepted', acceptedPort, baseline], ['candidate', candidatePort, '']]) {
    const child = spawn(process.execPath, [path.join(root,'node_modules/storybook/dist/bin/dispatcher.js'), 'dev', '-p', String(port), '--host', '127.0.0.1', '--ci', '--no-open'], { cwd: root, env: { ...process.env, STORYBOOK_BASELINE_ROOT: source }, stdio: ['ignore','pipe','pipe'] });
    servers.push(child);
    child.stdout.on('data', x => writeFile(path.join(out,`${label}-server.log`), x, { flag:'a' }));
    child.stderr.on('data', x => writeFile(path.join(out,`${label}-server.log`), x, { flag:'a' }));
    const deadline = Date.now() + 60000;
    while (true) {
      if (child.exitCode !== null) throw new Error(`${label} server exited; see log`);
      try { if ((await fetch(`http://127.0.0.1:${port}/index.json`)).ok) break; } catch { /* startup */ }
      if (Date.now() > deadline) throw new Error(`${label} server startup timed out`);
      await new Promise(r => setTimeout(r, 250));
    }
  }
  const index = await (await fetch(`http://127.0.0.1:${acceptedPort}/index.json`)).json();
  cases = Object.keys(index.entries).filter(id=>id.startsWith('product-accepted-baseline--')).map(id=>id.split('--')[1]);
  for (const required of ['home','library','extract','dialogue','review','cast-voices','generate','export']) {
    if (!cases.includes(required)) throw new Error(`Missing representative product story: ${required}`);
  }
  browser = await chromium.launch();
  const results = [];
  for (const viewport of [{ width:1440,height:1000 },{ width:390,height:844 }]) {
    for (const id of cases) {
      const captures = [];
      const accessibility = {};
      for (const [label,port] of [['accepted',acceptedPort],['candidate',candidatePort]]) {
        const page = await browser.newPage({ viewport, deviceScaleFactor:1, reducedMotion:'reduce' });
        const errors=[]; page.on('requestfailed', r=>errors.push(`${r.url()} ${JSON.stringify(r.failure())}`)); page.on('console', m=> {if(m.type()==='error')errors.push(m.text());}); page.on('pageerror', e => errors.push(e.message)); page.on('response', async response => {if(response.status() >= 400) errors.push(`${response.status()} ${response.url()} ${(await response.text()).slice(0,1000)}`);});
        await page.route('**/api/**', async route => {
          if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
          const key = route.request().url().includes('cover') ? 'libraryCoverImage' : route.request().url().includes('layered') ? 'silentWav' : 'sourceImage';
          const data = await page.evaluate(async key => (await import('/design-kit/syntheticContent.ts'))[key], key);
          const response = await fetch(data);
          await route.fulfill({ contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer()) });
        });
        await page.goto(`http://127.0.0.1:${port}/iframe.html?id=product-accepted-baseline--${id}&viewMode=story&legacyMedia=1`);
        await page.waitForSelector(`[data-scenario-ready="${id}"]`, {timeout:30000}).catch(async error => {
          await writeFile(path.join(out,`${label}-${id}-error.txt`), errors.join("\n")+"\n"+await page.locator('body').innerText());
          await page.screenshot({path:path.join(out,`${label}-${id}-error.png`)});
          throw error;
        });
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))); });
        await page.evaluate(() => window.scrollTo({top:0,left:0,behavior:'instant'}));
        await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
        let image;
        let prior;
        const stableDeadline = Date.now() + 10000;
        while (true) {
          image = await page.screenshot({fullPage:true,animations:'disabled'});
          if (prior?.equals(image)) break;
          if (Date.now() > stableDeadline) throw new Error(`${label}/${id}: screenshot never stabilized`);
          prior = image;
          await page.waitForTimeout(150);
        }
        await writeFile(path.join(out,`${id}-${viewport.width}-${label}.png`), image);
        captures.push(image);
        await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
        accessibility[label] = await page.evaluate(async () => (await window.axe.run('#storybook-root')).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({target,failureSummary})=>({target,failureSummary})) })));

        if(errors.length) throw new Error(`${label}/${id}: ${errors.join('; ')}`);
        await page.close();
      }
      const equal = captures[0].equals(captures[1]);
      const before = PNG.sync.read(captures[0]);
      const after = PNG.sync.read(captures[1]);
      const sameDimensions = before.width === after.width && before.height === after.height;
      let rawDifferentPixels = 0, maxChannelDelta = 0;
      if (sameDimensions) for(let i=0;i<before.data.length;i+=4) {
        let changed = false;
        for(let channel=0;channel<4;channel++) {
          const delta = Math.abs(before.data[i+channel]-after.data[i+channel]);
          maxChannelDelta = Math.max(maxChannelDelta,delta);
          changed ||= delta !== 0;
        }
        if(changed) rawDifferentPixels++;
      }
      const diff = new PNG({width:before.width,height:before.height});
      const significantDifferentPixels = sameDimensions ? pixelmatch(before.data,after.data,diff.data,before.width,before.height,{threshold:0.05}) : null;
      const passed = sameDimensions && significantDifferentPixels === 0;
      if (!passed) await writeFile(path.join(out,`${id}-${viewport.width}-diff.png`),PNG.sync.write(diff));
      results.push({scenario:id,width:viewport.width,byteIdentical:equal,sameDimensions,rawDifferentPixels,maxChannelDelta,significantDifferentPixels,passed,accessibility});
      await writeFile(path.join(out,'report.json'),JSON.stringify({baselineRef:ref,results},null,2));
      console.log(`${passed ? 'PASS':'DIFF'} ${id} ${viewport.width}`);
    }
  }
  await writeFile(path.join(out,'report.json'),JSON.stringify({baselineRef:ref,results},null,2));
  if(results.some(r=>!r.passed)) process.exitCode=1;
} finally {
  await browser?.close();
  for(const child of servers) child.kill('SIGTERM');
  await rm(baseline,{recursive:true,force:true});
}
