import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base=process.argv[2]??'http://127.0.0.1:6018';
const out=process.argv[3]??'/tmp/meowdiobooks-progress-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();const results=[];
try {
  for(const scenario of ['dialogue-running','generate-running','cast-sample-pending']) {
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await page.goto(`${base}/iframe.html?id=product-accepted-baseline--${scenario}&viewMode=story`);await page.waitForSelector('[data-scenario-ready]');
    const modal=page.locator('.process-overlay [role="dialog"]').last();await modal.waitFor();
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
    assert.equal(await modal.evaluate(element=>element.contains(document.activeElement)),true,'Progress takes initial focus');
    for(let i=0;i<12;i++) { await page.keyboard.press('Tab'); assert.equal(await modal.evaluate(element=>element.contains(document.activeElement)),true,'Progress traps focus'); }
    await page.keyboard.press('Escape');assert.equal(await modal.count(),1,'Escape must not discard active work');
    await page.screenshot({path:`${out}/${scenario}.png`});
    const cancellation=modal.getByRole('button',{name:/Cancel|Stop/});
    let restoration='not exercised: intentionally pending fixture has no completion control';
    if(await cancellation.count()) {
      await cancellation.click();await modal.waitFor({state:'hidden'});
      assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','Finishing cancellation releases scroll lock');
      restoration='passed after cancellation';
    }
    results.push({scenario,initialFocus:'passed',tabTrap:'passed',escapePreservesWork:'passed',scrollRestoration:restoration});await page.close();
  }
  await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
