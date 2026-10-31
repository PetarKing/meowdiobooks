import {chromium, webkit} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const phase=process.argv[2]||'before';
const out=process.argv[3] || '/tmp/meowdiobooks-cast-polish-evidence';await fs.mkdir(out,{recursive:true});
for(const [engine, browserType] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await browserType.launch({headless:true});
 for(const width of [390,1440]) for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width,height:1100},deviceScaleFactor:2});
 await page.goto(`${process.env.STORYBOOK_URL || "http://127.0.0.1:6018"}/iframe.html?id=workflow-cast-grid-polish--wrapped-metadata&viewMode=story&appearance=${theme}`);
 await page.locator('.cast-roster-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${out}/${phase}-${engine}-${width}-${theme}.png`,fullPage:true});
 const geometry=await page.locator('.cast-roster-card').evaluateAll(cards=>cards.map(c=>{const r=c.getBoundingClientRect(),p=c.querySelector('.cast-roster-portrait').getBoundingClientRect();return {name:c.getAttribute('aria-label'),top:r.top,height:r.height,portraitOffset:p.top-r.top};}));
 await fs.writeFile(`${out}/${phase}-${engine}-${width}-${theme}.json`,JSON.stringify(geometry,null,2));
 if(phase !== 'before' && width===390) for(const card of geometry) assert.equal(card.portraitOffset,9,card.name);
 if(width===390 && theme==='light' && engine==='chromium') {
 const source=page.getByRole('button',{name:'Inspect Subaru',exact:true});const target=page.getByRole('button',{name:'Inspect Subaru Natsuki',exact:true});
 const s=await source.boundingBox(),t=await target.boundingBox();
 await page.mouse.move(s.x+s.width/2,s.y+50);await page.mouse.down();
 await page.screenshot({path:`${out}/${phase}-1-press.png`});
 await page.mouse.move(s.x+s.width/2+25,s.y+65,{steps:8});await page.waitForTimeout(300);
 await page.screenshot({path:`${out}/${phase}-2-moving.png`});
 if(phase !== 'before') {
 const data=await page.locator('[data-cast-drag-image]').evaluate(c=>c.toDataURL());
 await fs.writeFile(`${out}/${phase}-native-drag-image.png`,Buffer.from(data.split(',')[1],'base64'));
 }
 await page.mouse.move(t.x+t.width/2,t.y+50,{steps:20});await page.waitForTimeout(300);
 await page.screenshot({path:`${out}/${phase}-3-hover.png`});
 await page.mouse.up();await page.waitForTimeout(300);
 await page.screenshot({path:`${out}/${phase}-4-drop.png`});
 assert.equal(await page.locator('.cast-roster-card').count(),6);
 assert.equal(await page.locator('[data-cast-drag-image]').count(),0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await page.locator('.cast-roster-card').count(),7);
 console.log(phase,'native drag, drop and undo passed');
 }
 await page.close();
 }await browser.close();
}
