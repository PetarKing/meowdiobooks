import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out=process.argv[2] ?? '/tmp/voice-reuse-details';
const url=process.argv[3] ?? 'http://127.0.0.1:5187/studio.html';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
for(const width of [1440,390]) {
 const page=await browser.newPage({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 const ready=()=>page.getByText('Synthetic data · safe to explore',{exact:true}).waitFor();
 await ready();
 const select=async name=>{await page.locator('.preview-controls select').selectOption(name);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await ready();};
 const capture=async(name,fullPage=false)=>{await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage});results.push({name,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),errors:[...errors]});};
 await select('cast-reuse-review');
 for(const [character,name] of [['Alice','cast-member'],['Queen of Hearts','cast-should-review'],['Royal Chorus','cast-must-review']]) {
  await page.getByRole('button',{name:`Inspect ${character}`,exact:true}).click();
  await page.getByRole('dialog',{name:`Inspect ${character}`,exact:true}).waitFor();
  await capture(name);
  await page.getByRole('button',{name:'Close cast member',exact:true}).click();
  await page.getByRole('dialog',{name:`Inspect ${character}`,exact:true}).waitFor({state:'detached'});
 }
 await select('cast-voices');
 await capture('voices-overview',true);
 await page.getByRole('button',{name:'Open Alice voice',exact:true}).getByText('Alice',{exact:true}).click();
 await page.getByRole('dialog',{name:'Alice voice',exact:true}).waitFor();
 await page.getByRole('dialog',{name:'Alice voice',exact:true}).getByText('From prior book',{exact:true}).waitFor();
 await capture('voice-auditions');
 await page.close();
}
await browser.close();await writeFile(`${out}/details-checks.json`,JSON.stringify(results,null,2));console.log(results);
