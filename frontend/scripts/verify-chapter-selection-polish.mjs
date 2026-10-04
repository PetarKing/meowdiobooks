// Render the production Generate page through its synthetic gateway, without provider work.
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] ?? '/tmp/meowdiobooks-chapter-selection-polish');
const base = process.env.GENERATION_REVIEW_URL ?? 'http://127.0.0.1:6027';
await mkdir(out, { recursive: true });
const report=[];
for (const engine of [chromium, webkit]) {
 const browser=await engine.launch();
 for (const viewport of [{width:390,height:844},{width:1440,height:1000}]) {
  for (const appearance of ['light','dark']) {
   const page=await browser.newPage({viewport,reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/iframe.html?id=workflow-generation-purchase--purchased-chapters&viewMode=story&appearance=${appearance}`);
   await page.waitForSelector('[data-scenario-ready="purchased-chapters"]',{timeout:45000});
   await page.evaluate(()=>document.fonts.ready);
   if(await page.getByRole('tab',{name:/^All/}).count())throw Error('All tab remains');
   await page.getByRole('tab',{name:'To make 3'}).waitFor();
   if(!await page.getByRole('tab',{name:'To make 3'}).getAttribute('aria-selected').then(x=>x==='true'))throw Error('Default is not To make');
   await page.getByRole('checkbox',{name:'Select Pig and Pepper'}).waitFor();
   if(await page.getByRole('checkbox',{name:'Select Pig and Pepper'}).isEnabled())throw Error('Empty chapter selectable');
   if(await page.getByRole('button',{name:'Listen to The Pool of Tears'}).count())throw Error('Current audio appears in To make');
   await page.getByRole('button',{name:'Listen to Down the Rabbit-Hole (older recording)'}).waitFor();
   const row=page.locator('.chapter-card.purchased').first();
   await page.mouse.move(0,0);
   const selected=await row.evaluate(e=>getComputedStyle(e).backgroundImage);
   await row.locator('input').uncheck();
   await page.mouse.move(0,0);
   await page.waitForTimeout(100);
   const plain=await row.evaluate(e=>getComputedStyle(e).backgroundImage);
   if(selected!==plain || !plain.includes('gradient'))throw Error(`Selected gold differs from normal gold: ${JSON.stringify({selected,plain})}`);
   await row.locator('input').check();
   const pending=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('.generation-selection button')].map(e=>e.textContent),bottomGap:innerHeight-document.querySelector('.generation-selection').getBoundingClientRect().bottom}));
   if(pending.overflow>1||Math.abs(pending.bottomGap-16)>2)throw Error(`Pending geometry ${JSON.stringify(pending)}`);
   await page.screenshot({path:`${out}/${engine.name()}-to-make-${viewport.width}-${appearance}.png`});
   await page.getByRole('tab',{name:'Generated 2'}).click();
   if(await page.getByRole('checkbox',{name:'Select Down the Rabbit-Hole'}).count())throw Error('Stale audio appears in Generated');
   if(await page.locator('.chapter-card').count()!==2)throw Error('Generated count incorrect');
   if(await page.locator('.chapter-card input:checked').count())throw Error('Hidden selection survived tab switch');
   await page.getByRole('checkbox',{name:'Select The Pool of Tears'}).check();
   if(!await page.getByRole('button',{name:'Continue to Export →'}).evaluate(e=>e.classList.contains('primary')))throw Error('Export is not primary');
   await page.getByRole('button',{name:'Regenerate 1 selected',exact:true}).waitFor();
   if(await page.locator('.generation-selection dl').count())throw Error('Ready selection shows unnecessary generation estimate');
   const generated=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,bottomGap:innerHeight-document.querySelector('.generation-selection').getBoundingClientRect().bottom,buttons:[...document.querySelectorAll('.generation-selection button')].map(e=>e.textContent)}));
   if(generated.overflow>1||Math.abs(generated.bottomGap-16)>2)throw Error(`Generated geometry ${JSON.stringify(generated)}`);
   await page.screenshot({path:`${out}/${engine.name()}-generated-${viewport.width}-${appearance}.png`});
   await page.getByRole('button',{name:'Continue to Export →'}).click();
   await page.getByRole('heading',{name:'Prepare your audiobook'}).waitFor();
   if(await page.locator('.edition-chapters input:checked').count()!==1)throw Error('Selected Export scope incorrect');
   if(errors.length)throw Error(errors.join('\n'));
   report.push({engine:engine.name(),viewport,appearance,passed:true,pending,generated});
   console.log(`PASS ${engine.name()} ${viewport.width} ${appearance}`);
   await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
   await page.close();
  }
 }
 await browser.close();
}
