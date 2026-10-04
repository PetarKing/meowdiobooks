// Synthetic rendered checks; never calls a payment provider or generation service.
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] ?? '/tmp/meowdiobooks-generation-layout');
const baseUrl = process.env.GENERATION_REVIEW_URL ?? 'http://127.0.0.1:6017';
await mkdir(out, { recursive: true });
const results=[];
for (const engine of [chromium, webkit]) {
 const browser=await engine.launch();
 for (const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:568}]) {
  for(const appearance of ['light','dark']) {
   for(const [id,ready] of [['workflow-generation-purchase--purchased-and-complete','purchased-and-complete'],['workflow-generation-purchase--purchased-chapters','purchased-chapters'],['product-accepted-baseline--generate-long-book','generate-long-book']]) {
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try {
     await page.goto(`${baseUrl}/iframe.html?id=${id}&viewMode=story&appearance=${appearance}`);
     await page.waitForSelector(`[data-scenario-ready="${ready}"]`,{timeout:45000});
     await page.evaluate(async()=>{await document.fonts.ready;});
     await page.waitForTimeout(300);
     const geometry=await page.evaluate(()=>{
      const dock=document.querySelector('.generation-selection');const rect=dock.getBoundingClientRect();const rows=[...document.querySelectorAll('.chapter-card')];
      return {bottomGap:innerHeight-rect.bottom,overflow:document.documentElement.scrollWidth-innerWidth,count:rows.length,purchasedLabel:rows.some(r=>r.textContent.includes('Purchased')),gold:rows.filter(r=>r.matches('.generated,.purchased')).map(r=>({className:r.className,background:getComputedStyle(r).backgroundImage})),dock:{x:rect.x,width:rect.width,height:rect.height}};
     });
     if(geometry.overflow>1 || geometry.purchasedLabel || Math.abs(geometry.bottomGap-16)>2) throw Error(JSON.stringify(geometry));
     if(geometry.gold.some(r=>!r.background.includes('gradient')))throw Error('Missing golden state');
     await page.screenshot({path:`${out}/${engine.name()}-${ready}-${viewport.width}-${appearance}.png`});
     if(ready==='purchased-and-complete'){
      await page.locator('.chapter-row-target').click();
      const selected=await page.locator('.chapter-card').evaluate(r=>getComputedStyle(r).backgroundImage);
      if(!selected.includes('gradient'))throw Error('Selected ready row lost gold');
      await page.screenshot({path:`${out}/${engine.name()}-completed-selected-${viewport.width}-${appearance}.png`});
     }
     if(ready==='generate-long-book'){
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(250);
      const last=await page.evaluate(()=>{const row=document.querySelector('.chapter-card:last-child').getBoundingClientRect();const dock=document.querySelector('.generation-selection').getBoundingClientRect();return {lastBottom:row.bottom,dockTop:dock.top,gap:innerHeight-dock.bottom};});
      if(last.lastBottom>last.dockTop || last.lastBottom<0 || Math.abs(last.gap-16)>2)throw Error(`Final row obscured ${JSON.stringify(last)}`);
      await page.screenshot({path:`${out}/${engine.name()}-long-bottom-${viewport.width}-${appearance}.png`});
     }
     if(errors.length)throw Error(errors.join('\n'));
     results.push({engine:engine.name(),ready,appearance,width:viewport.width,passed:true,geometry:{...geometry,goldCount:geometry.gold.length,gold:geometry.gold.slice(0,4)}});console.log(`PASS ${engine.name()} ${ready} ${viewport.width} ${appearance}`);
    }catch(e){results.push({engine:engine.name(),ready,appearance,width:viewport.width,passed:false,error:String(e),errors});console.log(`FAIL ${engine.name()} ${ready} ${viewport.width} ${appearance} ${e}`);}
    await page.close();await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));
   }
  }
 }
 await browser.close();
}
if(results.some(r=>!r.passed))process.exitCode=1;
