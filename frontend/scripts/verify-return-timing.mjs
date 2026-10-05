import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium, webkit } = createRequire(process.cwd() + '/frontend/package.json')('playwright');
const before = process.argv[2];
const after = process.argv[3];
assert(before && after, 'Pass baseline and changed Vite origins');
const out = process.env.RETURN_TIMING_EVIDENCE_DIR || '/private/tmp/meowdiobooks-return-timing';
await mkdir(out, { recursive: true });
const results = [];
const html = (delay, candidates) => `<!doctype html><html><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import App from '/src/App.tsx';import '/src/i18n.ts';import '/src/styles/product.css';
import { createFixtureGateway } from '/design-kit/gatewayFixture.ts';import { snapshotFor } from '/design-kit/snapshotFixture.ts';
const gateway=createFixtureGateway('generate-stale'), snapshot=snapshotFor('generate-stale');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
window.__timing={reads:[],providerCommands:0};
gateway.getBookSnapshot=async()=>{window.__timing.snapshotStart=performance.now();await sleep(${delay});return snapshot};
${candidates ? `snapshot.pendingCandidates={extraction:{revision:'e-pending'},dialogue:{revision:'d-pending'},review:{revision:'r-pending'},cast:{revision:'c-pending'}};
gateway.getStageCandidate=async(book,stage,revision)=>{window.__timing.reads.push({stage,start:performance.now()});await sleep(120);return stage==='cast'?snapshot.cast:{revision,spans:[],resultSummary:{},warnings:[]}};` : ''}
gateway.processStage=async()=>{window.__timing.providerCommands++;throw new Error('Provider prohibited in timing fixture')};
const inspect=()=>{const now=performance.now(),result=window.__timing;
 if(document.querySelector('.book-return'))result.noticeAt??=now;
 if(document.querySelector('.book-return-art'))result.artAt??=now;
 if(document.querySelector('.chapter-card'))result.contentAt??=now;
};
new MutationObserver(inspect).observe(document.documentElement,{childList:true,subtree:true});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App,{gateway,initialWorkflowLocation:{bookId:'kit-book',stepId:'generate'},appearance:'light'}));
</script></body></html>`;

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const [version, origin] of [['before', before], ['after', after]]) {
      for (const [scenario, delay, candidates] of [['fast', 100, false], ['ordinary', 600, false], ['sustained', 1100, false], ['candidates', 40, true]]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route(url => url.pathname === '/return-timing.html', route => route.fulfill({ contentType: 'text/html', body: html(delay, candidates) }));
        await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.continue());
        await page.goto(origin + '/return-timing.html');
        await page.getByRole('heading', { name: 'Record your chapters' }).waitFor().catch(async error => {
          console.error({ engine: engine.name(), version, scenario, errors, body: await page.locator('body').innerText() });
          await page.screenshot({ path: out + '/failure.png' });
          throw error;
        });
        const timing = await page.evaluate(() => window.__timing);
        assert.equal(timing.providerCommands, 0);
        assert.deepEqual(errors, []);
        const elapsed = Math.round(timing.contentAt - timing.snapshotStart);
        if (version === 'after' && ['fast', 'ordinary', 'candidates'].includes(scenario)) assert.equal(timing.artAt, undefined, 'Fast work never mounts book art');
        if (scenario === 'sustained') assert(timing.artAt, 'Long restore still offers book art');
        if (version === 'after' && candidates) {
          assert.equal(timing.reads.length, 4);
          assert(Math.max(...timing.reads.map(row => row.start)) - Math.min(...timing.reads.map(row => row.start)) < 60, 'Independent candidate requests start together');
        }
        assert.equal(await page.locator('.book-return').count(), 0, 'Return cover clears without a minimum dwell');
        results.push({ engine: engine.name(), version, scenario, snapshotDelayMs: delay, candidateDelayMs: candidates ? 120 : 0,
          elapsedMs: elapsed, artMounted: Boolean(timing.artAt), artDelayMs: timing.artAt ? Math.round(timing.artAt - timing.noticeAt) : null,
          candidateStartsMs: timing.reads.map(row => Math.round(row.start - timing.snapshotStart)) });
        console.log(`${engine.name()} ${version} ${scenario}: ${elapsed}ms; book=${Boolean(timing.artAt)}`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
await writeFile(out + '/report.json', JSON.stringify({ scope: 'Synthetic browser timing; controlled gateway delays, no providers or user data', results }, null, 2));
