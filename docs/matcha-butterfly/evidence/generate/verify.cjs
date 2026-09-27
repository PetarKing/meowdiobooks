const { chromium } = require('../../../../frontend/node_modules/playwright');
const fs = require('fs');
(async () => {
 const browser = await chromium.launch({headless:true});
 const results=[];
 for(const width of [1440,390]) for(const appearance of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:1100}});
  await page.goto(`http://127.0.0.1:5179/studio.html?appearance=${appearance}`);
  await page.getByRole('combobox',{name:'Preview',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Preview',exact:true}).selectOption('generate-stale');
  const ready=page.getByRole('heading',{name:'Record your chapters'}); await ready.waitFor();
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  const first=page.locator('.chapter-card').first();
  const checkbox=first.getByRole('checkbox');
  const titleBox=await first.getByRole('heading').boundingBox();
  await page.mouse.click(titleBox.x+titleBox.width/2,titleBox.y+titleBox.height/2);
  if(!await checkbox.isChecked()) { console.log(await first.evaluate(n=>({html:n.outerHTML,labelRect:n.querySelector('label').getBoundingClientRect().toJSON(),rowRect:n.getBoundingClientRect().toJSON(),labelStyle:getComputedStyle(n.querySelector('label')).cssText,hit:document.elementFromPoint(n.querySelector('h3').getBoundingClientRect().x+20,n.querySelector('h3').getBoundingClientRect().y+10)?.outerHTML}))); throw new Error('Title area did not select'); }
  const rowBox=await first.boundingBox();
  await page.mouse.click(rowBox.x+rowBox.width/2,rowBox.y+rowBox.height-7);
  if(await checkbox.isChecked()) throw new Error('Empty row area did not deselect');
  await checkbox.focus(); await page.keyboard.press('Space');
  if(!await checkbox.isChecked()) throw new Error('Native Space did not select');
  await first.getByRole('button',{name:'Listen to Down the Rabbit-Hole (older recording)'}).click();
  if(!await checkbox.isChecked()) throw new Error('Listen changed selection');
  const dialog=page.getByRole('dialog',{name:'Down the Rabbit-Hole'}); await dialog.waitFor();
  await dialog.getByRole('button',{name:'Close player'}).click();
  const noAudio=page.locator('.chapter-card.unavailable'); await noAudio.scrollIntoViewIfNeeded();
  const disabledBox=await noAudio.boundingBox();
  await page.mouse.click(disabledBox.x+disabledBox.width/2,disabledBox.y+disabledBox.height/2);
  if(await noAudio.getByRole('checkbox').isChecked()) throw new Error('Unavailable row selected');
  await page.getByRole('button',{name:'Select all shown'}).click();
  if(await noAudio.getByRole('checkbox').isChecked()) throw new Error('Select all selected unavailable');
  const selected=await page.locator('.chapter-card.selected').count(); if(selected!==5) throw new Error('Wrong available count');
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,rowHeights:[...document.querySelectorAll('.chapter-card')].map(n=>Math.round(n.getBoundingClientRect().height)),titleSize:getComputedStyle(document.querySelector('.chapter-card h3')).fontSize}));
  if(geometry.overflow>1) throw new Error(`Overflow ${geometry.overflow}`);
  await page.screenshot({path:require('path').join(__dirname, `generate-${width}-${appearance}.png`),fullPage:true});
  results.push({width,appearance,titleRowClick:true,emptyAreaClick:true,nativeSpace:true,listenIndependent:true,unavailableDisabled:true,selectAllExcludesUnavailable:true,...geometry});
  await page.close();
 }
 fs.writeFileSync(require('path').join(__dirname, 'report.json'),JSON.stringify({generatedAt:new Date().toISOString(),results},null,2)+'\n'); console.log(JSON.stringify(results,null,2)); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
