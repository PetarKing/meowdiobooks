import { chromium, webkit } from '../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const evidence = new URL('./evidence/', import.meta.url).pathname;
const engine = process.argv[2] === 'webkit' ? 'webkit' : 'chromium';
const prefix = engine === 'webkit' ? 'webkit-' : '';
const observations = [];
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
for (const width of [390, 320]) {
 const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
 const page = await context.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto('http://127.0.0.1:5182/studio.html?appearance=dark');
 await page.getByRole('status').filter({hasText:'Synthetic data'}).waitFor();
 await page.locator('.quick-upload input').setInputFiles({ name:'the-play-radio-drama-script.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF synthetic fixture') });
 const receipt = page.locator('.file-receipt');
 await receipt.screenshot({ path:`${evidence}/${prefix}import-selected-${width}.png` });
 const receiptBounds = await receipt.boundingBox();
 const replacementBounds = await page.locator('.import-file-replace').boundingBox();
 assert.ok(replacementBounds.width >= 44 && replacementBounds.height >= 44);
 // Native picker cancellation does not clear the File controlled by the page.
 await page.getByLabel('Choose another PDF').dispatchEvent('change');
 assert.equal(await receipt.locator('strong').textContent(),'the-play-radio-drama-script.pdf');
 const [picker] = await Promise.all([page.waitForEvent('filechooser'),page.locator('.import-file-replace').tap()]);
 await picker.setFiles({ name:'a-new-script.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF second synthetic fixture') });
 assert.equal(await receipt.locator('strong').textContent(),'a-new-script.pdf');
 await receipt.screenshot({ path:`${evidence}/${prefix}import-replaced-${width}.png` });
 await page.getByRole('combobox', {name:'Preview'}).selectOption('dialogue');
 await page.getByRole('heading',{name:'Build the transcript',exact:true}).waitFor();
 // The developer-only scenario selector has a WebKit intrinsic-width overflow;
 // measure the product surface independently from that toolbar.
 await page.locator('.preview-controls').evaluate(el=>el.style.display='none');
 const check = page.getByRole('checkbox',{name:'Dialogue with no speaker label'});
 assert.equal(await check.isChecked(),true);
 const scopes = page.locator('.attribution-scopes');
 await scopes.screenshot({ path:`${evidence}/${prefix}dialogue-selected-${width}.png` });
 await page.locator('.scope-target').filter({has:check}).getByText('Dialogue with no speaker label',{exact:true}).tap();
 assert.equal(await check.isChecked(),false);
 assert.equal(await page.getByRole('button',{name:'Build transcript →',exact:true}).isEnabled(),true);
 assert.equal(await page.getByText('No AI speaker matching will run.',{exact:true}).count(),1);
 await scopes.screenshot({ path:`${evidence}/${prefix}dialogue-deselected-${width}.png` });
 await page.locator('.scope-target').filter({has:check}).getByText('1 turn',{exact:true}).tap();
 assert.equal(await check.isChecked(),true);
 await page.locator('.scope-option').first().getByText('Example',{exact:true}).tap();
 assert.equal(await check.isChecked(),true);
 assert.equal(await page.locator('.scope-option').first().locator('details').evaluate(el=>el.open),true);
 await scopes.screenshot({ path:`${evidence}/${prefix}dialogue-example-${width}.png` });
 assert.equal(await page.getByRole('checkbox').count(),1);
 assert.equal(await page.getByText('None found',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Build transcript →',exact:true}).isEnabled(),true);
 const overflow = await page.evaluate(()=>({body:document.body.scrollWidth,document:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert.ok(overflow.body <= width && overflow.document <= width,JSON.stringify(overflow));
 // Verify full App with a first-load zero-target snapshot and no routing metadata.
 await page.evaluate(async()=>{
   const [{default:React},{default:ReactDOM},{default:App},{createFixtureGateway,snapshotFor}] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/App.tsx'), import('/design-kit/fixtures.ts')
   ]);
   const fixture = createFixtureGateway('dialogue');
   const snapshot=snapshotFor('dialogue');
   snapshot.dialogue={...snapshot.dialogue,regexes:[],routing:undefined,summary:{...snapshot.dialogue.summary,totalTurns:2,explicitTurns:2,unlabeledCandidates:0,openSpeakerTurns:0}};
   window.__mobileWorkflowCalls=[]; window.__mobileDialoguePreviews=0;
   const gateway={...fixture,getBookSnapshot:async()=>structuredClone(snapshot),previewDialogue:async()=>{window.__mobileDialoguePreviews++; if(window.__mobileDialoguePreviews>1) throw new Error('Zero targets must not request a provider route'); return structuredClone(snapshot.dialogue);},processStage:async(book,stage,settings)=>{window.__mobileWorkflowCalls.push({stage,settings});return fixture.processStage(book,stage,settings);}};
   const container=document.createElement('div');
   document.body.replaceChildren(container);
   ReactDOM.createRoot(container).render(React.createElement(App,{gateway,appearance:'dark'}));
 });
 await page.getByRole('button',{name:/Alice’s Adventures in Wonderland.*Continue/}).tap();
 await page.getByRole('heading',{name:'Build the transcript',exact:true}).waitFor();
 assert.equal(await page.getByRole('checkbox').count(),0);
 assert.equal(await page.getByText('None found',{exact:true}).count(),2);
 assert.equal(await page.getByRole('button',{name:'Build transcript →',exact:true}).isEnabled(),true);
 await page.locator('.dialogue-choice-panel').screenshot({path:`${evidence}/${prefix}dialogue-zero-targets-${width}.png`});
 await page.getByRole('button',{name:'Build transcript →',exact:true}).tap();
 await page.waitForFunction(()=>window.__mobileWorkflowCalls?.some(call=>call.stage==='dialogue'));
 const calls=await page.evaluate(()=>window.__mobileWorkflowCalls);
 assert.equal(await page.evaluate(()=>window.__mobileDialoguePreviews),1);
 assert.equal(calls[0].settings.strategy,'narrate');
 assert.deepEqual(calls[0].settings.attributionTargets,[]);
 assert.equal(errors.length,0,errors.join('\n'));
 observations.push({engine,width,receiptBounds,replacementBounds,overflow,calls,errors});
 await context.close();
}
await browser.close();
fs.writeFileSync(`${evidence}/${prefix}home-dialogue-mobile-observations.json`,JSON.stringify(observations,null,2));
console.log(JSON.stringify(observations,null,2));
