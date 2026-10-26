import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out=process.argv[2] ?? '/private/tmp/voice-reuse-approval';
const url=process.argv[3] ?? 'http://127.0.0.1:5186/studio.html';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
for(const width of [1440,390]) {
 const page=await browser.newPage({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.getByText('Synthetic data · safe to explore',{exact:true}).waitFor();
 for(const [scenario,name] of [['cast-identities','cast'],['cast-inspector','voices'],['cast-reuse-review','review-priority']]) {
  await page.locator('.preview-controls select').selectOption(scenario);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.getByText('Synthetic data · safe to explore',{exact:true}).waitFor();
  await page.getByText('From prior book',{exact:true}).first().waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});
  await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:name!=="voices"});
  results.push({scenario,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),errors:[...errors]});
 }
 await page.close();
}
await browser.close(); await writeFile(`${out}/checks.json`,JSON.stringify(results,null,2)); console.log(results);
