/** Arrange review-typography screenshots without changing their pixels or rendering fonts again. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const output = path.resolve(process.argv[2] ?? '/tmp/typography-review');
const cards = [
  { id: 'A-home-heart', title: 'A · Homepage headline', description: 'Geist Serif Heart adds a heart-shaped full stop. The released font is upright; colour preserves the emphasis.', after: 'Heart headline · proposed Sans supporting text' },
  { id: 'B-serif-headings', title: 'B · Headings and character names', description: 'Regular Geist Serif for display text. The wordmark and monogram initials keep their existing font.', after: 'Regular Serif headings · proposed Sans labels' },
  { id: 'C-sans-interface', title: 'C · Interface text and controls', description: 'Geist Sans for choices, labels, navigation and supporting copy.', after: 'Geist Sans interface' },
  { id: 'D-sans-reading', title: 'D · Manuscript text', description: 'Geist Sans for extracted prose and review passages. Original document images are unchanged.', after: 'Geist Sans reading text' },
];
await mkdir(output, { recursive: true });
for (const card of cards) {
  card.beforeImage = (await readFile(path.join(output, 'before', `${card.id}.png`))).toString('base64');
  card.afterImage = (await readFile(path.join(output, 'after', `${card.id}.png`))).toString('base64');
}
const sections = cards.map(card => `<section id="${card.id}"><small>MEOWDIOBOOKS · DRAFT TYPOGRAPHY OPTIONS</small><h2>${card.title}</h2><p>${card.description}</p><div class="pair"><figure><figcaption>Before · current main</figcaption><img src="data:image/png;base64,${card.beforeImage}"></figure><figure><figcaption>After · ${card.after}</figcaption><img src="data:image/png;base64,${card.afterImage}"></figure></div><footer>Actual application screenshots · same sizes and spacing · all four proposals shown together, committed separately · synthetic book data</footer></section>`).join('');
await writeFile(path.join(output, 'index.html'), `<!doctype html><html><meta charset="utf-8"><title>Meowdiobooks typography draft</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#e4e6db;color:#2d3825;font-family:system-ui,sans-serif}section{background:#fafbf5;border:1px solid #ccd0c1;border-radius:18px;padding:28px;margin:0 auto 32px;max-width:1660px}small{font-size:12px;letter-spacing:.13em;color:#68705d}h2{font-size:30px;margin:10px 0}p{font-size:16px;margin:0 0 24px;color:#65705b}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}figure{margin:0;background:#f1f2e8;border:1px solid #d7dacb;border-radius:12px;overflow:hidden}figcaption{padding:14px 18px;background:#fffef9;font-size:16px;font-weight:650;border-bottom:1px solid #d7dacb}img{display:block;width:100%;height:auto}footer{margin-top:20px;color:#737a68;font-size:12px}</style><body>${sections}</body></html>`);
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1660, height: 1100 } });
  await page.goto(`file://${path.join(output, 'index.html')}`);
  await page.evaluate(async () => Promise.all([...document.images].map(image => image.decode())));
  for (const card of cards) await page.locator(`[id="${card.id}"]`).screenshot({ path: path.join(output, `${card.id}.png`) });
} finally { await browser.close(); }
console.log(`Four comparison sheets saved to ${output}`);
