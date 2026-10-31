import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base=process.argv[2]??'http://127.0.0.1:6018';
const out=process.argv[3]??'/tmp/meowdiobooks-collections-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    for(const [scenario,voice] of [['cast-dense',false],['cast-voices-dense',true]]) {
      const page=await browser.newPage({viewport,reducedMotion:'reduce'});
      await page.goto(`${base}/iframe.html?id=product-accepted-baseline--${scenario}&viewMode=story`);
      await page.waitForSelector('[data-scenario-ready]');
      const search=page.getByRole('searchbox',{name:'Search cast'});
      const filter=page.getByRole('combobox',{name:'Show cast'});
      const gate=page.getByRole('button',{name:voice?'Accept cast & voices →':'Next →'});
      assert.equal(await gate.isDisabled(),true,'Required group must block continuation');
      await search.fill(voice?'A. Liddell':'Hearts');
      await page.waitForFunction(() => document.querySelectorAll('.cast-board .cast-tile:not(.cast-narrator-tile)').length===1);
      assert.equal(await gate.isDisabled(),true,'Hiding the required group must not remove its gate');
      if(!voice) assert.match(await page.locator('.cast-board').innerText(),/The Queen/,'Source label search must find the different canonical name');
      else assert.match(await page.locator('.cast-board').innerText(),/Alice/,'Literal alias search must find Alice');
      await search.fill(''); await filter.selectOption('required');
      await page.waitForFunction(() => document.querySelectorAll('.cast-board .cast-tile:not(.cast-narrator-tile)').length===1);
      assert.match(await page.locator('.cast-board').innerText(),/Alice & White Rabbit/);
      await search.fill('no such reader');
      await page.getByText('No cast members match these filters.',{exact:true}).waitFor();
      assert.equal(await gate.isDisabled(),true);
      await page.locator('.collection-toolbar').getByRole('button',{name:'Clear',exact:true}).click();
      assert.equal(await filter.inputValue(),'all');assert.equal(await search.inputValue(),'');assert.equal(await search.evaluate(element=>element===document.activeElement),true);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:`${out}/${scenario}-${viewport.width}.png`,fullPage:true});
      results.push({scenario,viewport,aliasSearch:'passed',requiredFilter:'passed',hiddenRequiredGate:'passed',clearFocus:'passed'});
      await page.close();
    }
  }
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await page.goto(`${base}/iframe.html?id=product-accepted-baseline--cast-inspector&viewMode=story`);await page.waitForSelector('[data-scenario-ready]');
  const notes=page.getByRole('textbox',{name:'Performance notes'});await notes.fill('A careful, reversible draft direction.');
  // Hit the actual bottom navigation coordinates. The backdrop must intercept it.
  const library=page.getByRole('button',{name:/^Library/});const bounds=await library.boundingBox();
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('heading',{name:'Your audiobooks'}).count(),0,'Background Library navigation must not run through inspector');
  // Clicking the backdrop may deliberately dismiss. Reopen if so, then test keyboard lifecycle.
  if(await page.getByRole('dialog',{name:'Alice voice'}).count()===0)await page.getByRole('button',{name:'Open Alice voice'}).click();
  await page.getByRole('dialog',{name:'Alice voice'}).waitFor();
  if (await notes.count()) assert.equal(await notes.inputValue(), 'A careful, reversible draft direction.', 'Background navigation coordinates must preserve draft notes');
  for (let i=0;i<20;i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true, 'Tab must stay within the inspector');
  }
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Alice voice'}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Open Alice voice'}).evaluate(element=>element===document.activeElement),true,'Escape must return focus to voice tile');
  results.push({scenario:'phone-inspector-background-navigation',backgroundNavigation:'blocked',escapeReturnFocus:'passed'});
  await page.close();
  await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
