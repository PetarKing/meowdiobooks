// Synthetic modal/rotation and font-enlargement regression for the Generate dock.
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] ?? '/tmp/meowdiobooks-generation-layout');
const baseUrl = process.env.GENERATION_REVIEW_URL ?? 'http://127.0.0.1:6017';
await mkdir(out, { recursive: true });
const reports=[];
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch();
 for(const width of [390,320,1440]) {
  const page=await browser.newPage({viewport:{width,height:width===1440?1000:844},reducedMotion:'reduce'}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${baseUrl}/iframe.html?id=product-accepted-baseline--generate-long-book&viewMode=story`);
  await page.waitForSelector('[data-scenario-ready="generate-long-book"]');
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(250);
  const before=await page.evaluate(()=>({scrollY,spacer:document.querySelector('.generation-selection-anchor').style.height}));
  await page.evaluate(()=>document.querySelector('.phase-help-trigger').click());await page.getByRole('dialog').waitFor();
  if(await page.evaluate(()=>document.body.style.position)!=='fixed')throw Error('Not locked');
  // Force an actual layout notification while document scroll is frozen.
  await page.setViewportSize({width:width+10,height:(width===1440?1000:844)-20});await page.waitForTimeout(200);
  await page.getByRole('button',{name:'Close phase guide'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForTimeout(250);
  const after=await page.evaluate(()=>{const dock=document.querySelector('.generation-selection').getBoundingClientRect();const last=document.querySelector('.chapter-card:last-child').getBoundingClientRect();return {scrollY,gap:innerHeight-dock.bottom,spacer:document.querySelector('.generation-selection-anchor').style.height,lastBottom:last.bottom,dockTop:dock.top,overflow:document.documentElement.scrollWidth-innerWidth};});
  if(Math.abs(after.gap-16)>2 || after.spacer!=='32px' || after.overflow>1)throw Error(JSON.stringify({before,after}));
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(250);
  const end=await page.evaluate(()=>({lastBottom:document.querySelector('.chapter-card:last-child').getBoundingClientRect().bottom,dockTop:document.querySelector('.generation-selection').getBoundingClientRect().top}));
  if(end.lastBottom>end.dockTop)throw Error(`Last row obscured at actual document end ${JSON.stringify(end)}`);
  await page.locator('.language-toggle button').nth(1).click();await page.waitForTimeout(200);
  await page.evaluate(()=>{
   const elements=[...document.querySelectorAll('.chapter-card h3,.chapter-card-meta span,.chapter-card-meta small,.generation-selection button,.generation-selection b')].map(element=>({element,size:parseFloat(getComputedStyle(element).fontSize)}));
   for(const {element,size}of elements)element.style.fontSize=`${size*2}px`;
  });await page.waitForTimeout(300);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(200);
  const expanded=await page.evaluate(()=>{const dock=document.querySelector('.generation-selection').getBoundingClientRect();return {gap:innerHeight-dock.bottom,overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('.generation-selection button')].map(b=>({width:b.getBoundingClientRect().width,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth}))};});
  if(expanded.overflow>1 || Math.abs(expanded.gap-16)>2 || expanded.buttons.some(b=>b.scrollWidth>b.clientWidth+1))throw Error(JSON.stringify(expanded));
  if(errors.length)throw Error(errors.join('\n'));
  await page.screenshot({path:`${out}/${engine.name()}-modal-return-zh-expanded-${width}.png`});
  reports.push({engine:engine.name(),width,before,after,end,expanded,passed:true});console.log(`PASS modal restore/resize and Chinese 200% ${engine.name()} ${width}`);await page.close();
 }
 await browser.close();
}
await writeFile(`${out}/edge-report.json`,JSON.stringify(reports,null,2));
