// Browser reattachment regression through the actual shared App and synthetic gateway.
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] ?? '/tmp/meowdiobooks-generation-resume');
const base = process.env.GENERATION_REVIEW_URL ?? 'http://127.0.0.1:6027';
await mkdir(out, { recursive: true });
const report = [];
for (const engine of [chromium, webkit]) {
 const browser = await engine.launch();
 for (const viewport of [{width:390,height:844},{width:1440,height:1000}]) {
  for (const appearance of ['light','dark']) {
   const page = await browser.newPage({viewport,reducedMotion:'reduce'});
   const errors = [];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/iframe.html?id=workflow-generation-resume--running-one-chapter&viewMode=story&appearance=${appearance}`);
   await page.waitForSelector('[data-scenario-ready="resumed-one-chapter"]',{timeout:45000});
   await page.evaluate(()=>document.fonts.ready);
   const dialog = page.getByRole('dialog',{name:'Making your selected chapters…'});
   await dialog.getByText('0 of 1 ready').waitFor();
   if (!await page.getByLabel('Select Down the Rabbit-Hole').isChecked()) throw Error('Requested chapter not selected');
   if (await page.getByLabel('Select The Pool of Tears').isChecked()) throw Error('Unrequested chapter selected');
   const running = await page.evaluate(()=>({
     position:document.body.style.position,
     inert:document.querySelector('.workspace').hasAttribute('inert'),
     selected:document.querySelectorAll('.chapter-card input:checked').length,
     overflow:document.documentElement.scrollWidth-innerWidth,
     dialog:document.querySelector('.generation-modal').getBoundingClientRect().toJSON(),
   }));
   if (running.position!=='fixed'||!running.inert||running.selected!==1||running.overflow>1) throw Error(JSON.stringify(running));
   await page.screenshot({path:`${out}/${engine.name()}-running-${viewport.width}-${appearance}.png`});
   await dialog.getByRole('button',{name:'Cancel audio generation'}).click();
   await dialog.waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Generate 1 selected →'}).waitFor();
   if (await page.getByLabel('Select The Pool of Tears').isChecked()) throw Error('Cancellation broadened request');
   const canceled = await page.evaluate(()=>({position:document.body.style.position,inert:document.querySelector('.workspace').hasAttribute('inert'),selected:document.querySelectorAll('.chapter-card input:checked').length,overflow:document.documentElement.scrollWidth-innerWidth}));
   if(canceled.position==='fixed'||canceled.inert||canceled.selected!==1||canceled.overflow>1)throw Error(JSON.stringify(canceled));
   if(errors.length)throw Error(errors.join('\n'));
   await page.screenshot({path:`${out}/${engine.name()}-canceled-${viewport.width}-${appearance}.png`});
   report.push({engine:engine.name(),viewport,appearance,passed:true,running,canceled});
   await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
   console.log(`PASS ${engine.name()} ${viewport.width} ${appearance}`);
   await page.close();
  }
 }
 await browser.close();
}
