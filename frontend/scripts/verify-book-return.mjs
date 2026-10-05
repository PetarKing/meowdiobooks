import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(process.cwd() + '/frontend/package.json')('playwright');
const origin=process.argv[2] || 'http://127.0.0.1:5192';
const out=process.env.BOOK_RETURN_EVIDENCE_DIR || '/private/tmp/meowdiobooks-book-return-check';
await mkdir(out,{recursive:true});
const report=['resume','context-only','preload-only'].includes(process.argv[3])?JSON.parse(await (await import('node:fs/promises')).readFile(out+'/report.json','utf8')):[];
const html=`<!doctype html><html><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import App from '/src/App.tsx';import { persistWorkflowReturn } from '/src/workflow/navigation.ts';
import '/src/i18n.ts';import '/src/styles/product.css';import { createFixtureGateway } from '/design-kit/gatewayFixture.ts';
const gateway=createFixtureGateway('dialogue-accepted');const get=gateway.getBookSnapshot;
let release;const waiting=new Promise(r=>release=r);window.__releaseSnapshot=release;
gateway.getBookSnapshot=async(...args)=>{await waiting;return get(...args)};
window.__providerCommands=0;gateway.processStage=async()=>{window.__providerCommands++;throw new Error('Provider prohibited in independent fixture')};
persistWorkflowReturn('kit-book','dialogue',{namespace:'independent-book-return'});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,{},React.createElement(App,{gateway,workflowPersistenceNamespace:'independent-book-return',appearance:new URLSearchParams(location.search).get('appearance')==='dark'?'dark':'light'})));
</script></body></html>`;
for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{
  for(const scenario of (process.argv[3]==='preload-only'?['preload-failure']:process.argv[3]==='context-only'?['context-loss']:process.argv[3]==='resume'&&engine===chromium?['library']:['normal','reduced','no-webgl','delayed-module','failed-module','context-loss','home','library','preload-failure'])){
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:scenario==='reduced'?'reduce':'no-preference'});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR: '+e.message)});page.on('requestfailed',r=>console.error('FAILED '+r.url()+' '+r.failure()?.errorText));
   await page.route(url=>url.pathname==='/independent-book-return.html',r=>r.fulfill({contentType:'text/html',body:scenario==='preload-failure'?html.replace("persistWorkflowReturn('kit-book','dialogue',{namespace:'independent-book-return'});",''):html}));
   await page.route('**/api/**',r=>new URL(r.request().url()).pathname.startsWith('/api/')?r.abort():r.continue());
   await page.addInitScript(()=>{
    const realRAF=window.requestAnimationFrame.bind(window),realCancel=window.cancelAnimationFrame.bind(window),pending=new Set();
    window.__pendingAnimationFrames=pending;window.__lostContexts=0;
    window.requestAnimationFrame=cb=>{let id=realRAF(time=>{pending.delete(id);cb(time)});pending.add(id);return id};window.cancelAnimationFrame=id=>{pending.delete(id);return realCancel(id)};
    for(const proto of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean)){
      const real=proto.getExtension;proto.getExtension=function(name){const ext=real.call(this,name);if(name==='WEBGL_lose_context'&&ext&&!ext.__instrumented){const lose=ext.loseContext.bind(ext);ext.loseContext=()=>{window.__lostContexts++;return lose()};ext.__instrumented=true}return ext};
    }
   });
   if(scenario==='no-webgl')await page.addInitScript(()=>{const real=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'||type==='experimental-webgl'?null:real.call(this,type,...args)}});
   let releaseModule;const moduleWait=new Promise(r=>releaseModule=r);let held=0;
   if(scenario==='delayed-module'||scenario==='failed-module'||scenario==='preload-failure')await page.route(url=>/\/AnimatedBook\.tsx$/.test(url.pathname),async r=>{held++;if(scenario==='failed-module'||scenario==='preload-failure')await r.abort();else{await moduleWait;await r.continue()}});
   await page.goto(origin+'/independent-book-return.html?appearance='+(['context-loss','reduced'].includes(scenario)?'dark':'light'));
   if(scenario==='preload-failure'){
    await page.getByRole('heading',{name:'Start another book'}).waitFor();await page.waitForTimeout(500);
    assert(held>0,'Background module preload was attempted');assert.equal(await page.locator('.book-return').count(),0);assert.deepEqual(errors,[],'Preload rejection is handled while Home stays usable');
    report.push({engine:engine.name(),scenario,result:'passed'});console.log(engine.name()+': '+scenario+' passed');await context.close();continue;
   }
   const status=page.locator('.book-return');await status.waitFor({timeout:12000}).catch(async e=>{console.error(await page.locator('body').innerText());await page.screenshot({path:out+'/debug-'+engine.name()+'-'+scenario+'.png'});throw e});
   assert(await page.getByRole('heading',{name:'Opening your book',exact:true}).isVisible());
   // The delayed snapshot makes this a sustained wait. Decoration is deliberately
   // absent for ordinary short restores; wait for its threshold before testing it.
   await status.locator('.book-return-art').waitFor();
   if(scenario==='delayed-module'){
    await page.waitForTimeout(400);assert(held>0,'Lazy module intercepted');assert.equal(await status.locator('.book-return-static').count(),0,'No alternate book is shown while warming');assert.equal(await status.locator('canvas').count(),0);
    assert.equal(await status.locator('.book-return-static svg').count(),0,'Old SVG book is removed');

    const before={art:await status.locator('.book-return-art').boundingBox(),heading:await status.locator('h1').boundingBox()};
    await page.screenshot({path:out+'/'+engine.name()+'-warming.png'});
    releaseModule();await status.locator('[data-renderer="webgl"]').waitFor();
    assert.deepEqual(await status.locator('.book-return-art').boundingBox(),before.art,'Art frame does not move on renderer readiness');
    assert.deepEqual(await status.locator('h1').boundingBox(),before.heading,'Heading does not move on renderer readiness');
    assert.deepEqual(await status.locator('canvas').boundingBox(),before.art,'Canvas uses the reserved art frame');
   }
   if(scenario==='failed-module'||scenario==='no-webgl'){
    await page.waitForTimeout(700);assert.equal(await status.locator('.book-return-static').count(),0,'Failure keeps the text-only status');assert(await status.isVisible());
   }else{
    await status.locator('canvas').waitFor();await page.waitForTimeout(400);
    if(scenario==='reduced')assert.equal(await page.evaluate(()=>window.__pendingAnimationFrames.size),0,'Reduced motion schedules no animation frames');
    if(scenario==='context-loss'){
      await status.locator('canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
      await page.waitForTimeout(100);assert.equal(await status.locator('.book-return-static').count(),0,'Context loss keeps the text-only status');assert.equal(await status.locator('canvas').evaluate(e=>getComputedStyle(e).display),'none','Lost-context canvas is hidden, retaining the heading');
    }
   }
   assert.equal(await page.locator('.book-return-atmosphere').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('.book-return-atmosphere').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
   assert((await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=1,'Mobile layout does not overflow');
   await page.screenshot({path:out+'/'+engine.name()+'-'+scenario+'.png'});
   if(scenario==='home')await page.getByRole('button',{name:'Go to Home'}).click();
   if(scenario==='library'){await page.setViewportSize({width:1440,height:844});await page.getByRole('button',{name:/^Library(?:,|$)/}).click();}
   await page.evaluate(()=>window.__releaseSnapshot());
   if(scenario==='home')await page.getByRole('heading',{name:'Start another book'}).waitFor({state:'attached'});
   else if(scenario==='library')await page.getByRole('heading',{name:'Your audiobooks',exact:true}).waitFor();
   else await page.getByRole('navigation',{name:'Wizard stages'}).waitFor();
   await page.waitForTimeout(150);assert.equal(await page.locator('.book-return').count(),0,'Loading composition unmounts');assert.equal(await page.evaluate(()=>window.__pendingAnimationFrames.size),0,'Renderer animation loop is cleaned up');assert.equal(await page.evaluate(()=>window.__providerCommands),0);
   if(['home','library'].includes(scenario))assert.equal(await page.getByRole('navigation',{name:'Wizard stages'}).count(),0,'Explicit navigation wins delayed restoration');
   assert.deepEqual(errors,[],'No uncaught page errors');const prior=report.findIndex(r=>r.engine===engine.name()&&r.scenario===scenario);if(prior>=0)report.splice(prior,1);report.push({engine:engine.name(),scenario,result:'passed',lostContexts:await page.evaluate(()=>window.__lostContexts),...(scenario==='context-loss'?{lostCanvasComputedDisplay:'none'}:{})});console.log(engine.name()+': '+scenario+' passed');await context.close();
  }
 }finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
}
