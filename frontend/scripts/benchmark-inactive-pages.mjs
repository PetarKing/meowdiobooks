/** Production-browser probe. Synthetic accepted book; no providers or local book data. */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(root, `.${pathname === '/' || pathname === '/library' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${root}/`)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const scenarios = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const chapterCount of [40, 200, 1000]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const book = { id: 'synthetic-perf', title: 'Synthetic performance book', author: 'Fixture', source_name: 'synthetic.pdf', page_count: chapterCount * 5 };
    const chapters = Array.from({ length: chapterCount }, (_, i) => ({ id: `chapter-${i}`, title: `Chapter ${i + 1}`, startPage: i * 5 + 1, endPage: i * 5 + 5 }));
    const snapshot = {
      book, activeArtifacts: { extraction: 'e1', dialogue: 'd1', review: 'r1', cast: 'c1', script: 's1' },
      dialogue: { profiles: [], summary: { totalTurns: 0, explicitTurns: 0, openSpeakerTurns: 0, unlabeledCandidates: 0, conflicts: 0 }, examples: [] },
      reviewWarnings: Array.from({ length: 50 }, (_, i) => ({ id: `warning-${i}`, kind: 'repeated-matter', severity: 'warning', detail: 'Synthetic issue', availableActions: ['keep'], occurrences: [{ id: `occurrence-${i}`, page: i + 1, source: 'Synthetic source' }] })),
      reviewInspection: { decisions: [], boundaryDecisions: [], consequences: {}, history: [] }, boundaryCandidates: [],
      cast: { revision: 'c1', phase: 'accepted', dossiers: [], proposals: [], identities: [], narrator: { characterId: 'narrator', name: 'Narrator' }, language: 'english', voiceModel: 'fixture' },
      voiceModels: [{ id: 'fixture', label: 'Fixture', supportedLanguages: ['english'] }], voiceSelection: { modelId: 'fixture', language: 'english' },
      recordingScript: { revision: 's1', status: 'ready', sourceCoverage: { status: 'exact' }, entries: [], summary: { emptyChapterIds: [], estimatedSeconds: chapterCount * 60, chapters: chapters.map((chapter) => ({ chapterId: chapter.id, estimatedSeconds: 60, retainedCharacters: 900, empty: false })) }, inputRevisions: { dialogue: 'd1', review: 'r1', cast: 'c1' } },
      chapters, generatedChapters: chapters.map((chapter) => ({ chapterId: chapter.id, revision: 'audio1', audioUrl: '/synthetic.wav', audioSeconds: 60, current: true, staleReasons: [], segments: [], inputRevisions: { dialogue: 'd1', cast: 'c1' } })), history: {},
    };
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/api/books' ? [book] : path.endsWith('/snapshot') ? snapshot : [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(origin);
    const logo = await page.locator('.cat-mark img').evaluate(async (img) => {
      await img.decode();
      return { src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight };
    });
    await page.getByRole('button', { name: /Synthetic performance book.*Continue/ }).click();
    await page.getByRole('navigation', { name: 'Wizard stages' }).waitFor();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('heading', { name: /Library|Your audiobooks/ }).waitFor();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const samples = await page.evaluate(async () => {
      const button = document.querySelector('.theme-toggle');
      const samples = [];
      for (let i = 0; i < 65; i++) {
        const before = document.querySelector('.app-shell').getAttribute('data-appearance');
        const started = performance.now();
        button.click();
        await new Promise((done) => queueMicrotask(done));
        if (document.querySelector('.app-shell').getAttribute('data-appearance') === before) throw new Error('Appearance did not commit');
        const elapsed = performance.now() - started;
        if (i >= 15) samples.push(elapsed);
      }
      return samples;
    });
    samples.sort((a, b) => a - b);
    const visibleSteps = [];
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    for (const [step, heading] of [['Extract', 'Extraction complete'], ['Review', 'Review complete'], ['Export', 'Prepare your audiobook']]) {
      await page.getByRole('navigation', { name: 'Wizard stages' }).getByRole('button', { name: new RegExp(`^${step}`) }).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      visibleSteps.push({ step, heading });
    }
    const exportChapterChoices = await page.locator('.edition-chapters input[type=checkbox]').count();
    if (exportChapterChoices !== chapterCount) throw new Error('Export lost playable chapters');
    scenarios.push({ chapterCount, warningGroups: 50, view: 'Library with accepted book retained in model', cpuThrottle: 4, samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)], minMs: samples[0], maxMs: samples.at(-1), logo, visibleSteps, exportChapterChoices, errors });
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  const result = { measuredAt: new Date().toISOString(), browser: await browser.version(), measurement: 'Synchronous theme click through React commit; 15 warmups + 50 samples, 4x Chromium CPU throttle. Synthetic accepted chapters, no backend/generation claims.', scenarios };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); server.close(); }
