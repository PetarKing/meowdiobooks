import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const dir=fileURLToPath(new URL('../src/', import.meta.url));
const reportPath=process.argv[2] ?? fileURLToPath(new URL('../../docs/matcha-butterfly/evidence/appearance/contrast.json', import.meta.url));
const css=['styles/appearance.css','styles.css','media.css','styles/primitives.css','components/CastIdentityReview.css','components/LanguagePicker.css','components/CastingChoice.css'].map(p=>fs.readFileSync(dir+p,'utf8').replace(/@import[^;]+;/g,'')).join('\n');
const browser=await chromium.launch({headless:true}); const page=await browser.newPage();
await page.setContent(`<style>${css}</style><div data-presentation-root data-appearance="light" id="root" style="padding:32px"><button class="primary">Continue</button><button class="danger">Delete</button><span class="tag good">Accepted</span><span class="tag warn">Warning</span><span class="tag rose">Selected</span><p class="error-note">Source unavailable</p><div class="source-excerpt"><p>Source evidence <mark>Highlighted source</mark></p></div><p class="soft-note">Recovery note</p><div class="choice"><div class="choice-title">Quality <small>Recommended</small></div><span class="choice-tooltip visible">Information tooltip</span></div><div class="cast-merge-undo">Identity merged <button>Undo</button></div><button class="approve">Approve</button><button class="theme-toggle" aria-label="Toggle dark mode"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></button><div class="dialogue-accepted-check">✓</div><audio controls></audio></div>`);
const report={executedAt:new Date().toISOString(),browser:browser.version(),scope:'Synthetic controls rendered with the production appearance and inherited styles; solid surface contrast measurements, not an end-to-end workflow audit.',sourceFiles:['frontend/src/styles/appearance.css','frontend/src/styles.css','frontend/src/media.css','frontend/src/styles/primitives.css','frontend/src/components/CastIdentityReview.css','frontend/src/components/LanguagePicker.css','frontend/src/components/CastingChoice.css'],appearances:{}};
for(const appearance of ['light','dark']) {
 await page.locator('#root').evaluate((el,a)=>el.dataset.appearance=a,appearance);
 await page.waitForTimeout(200);
 const rows=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
  function rgba(color){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(x=>x/255)}
  const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
  function background(el){if(!el)return [1,1,1];const bg=rgba(getComputedStyle(el).backgroundColor);return over(bg,background(el.parentElement));}
  function lum(rgb){return rgb.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}
  return [...document.querySelectorAll('#root button,#root .tag,#root p,#root mark,#root small,#root .choice-tooltip,#root select,#root .dialogue-accepted-check')].map(el=>{const st=getComputedStyle(el),bg=background(el),fg=over(rgba(st.color),bg),a=lum(fg),b=lum(bg);return {selector:el.className||el.tagName,text:el.textContent.slice(0,30),tokens:[st.getPropertyValue('--poppy'),st.getPropertyValue('--folio-action'),st.getPropertyValue('--danger-action')],foreground:st.color,background:st.backgroundColor,ratio:((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)}})
 });
 const nativeAudioColorScheme=await page.locator('audio').evaluate(el=>getComputedStyle(el).colorScheme);
 report.appearances[appearance]={nativeAudioColorScheme,measurements:rows};
 for(const row of rows) if(Number(row.ratio)<4.5) throw new Error(`${appearance}: ${row.selector} has contrast ${row.ratio}`);
}
await browser.close();
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(`Appearance contrast passed in light and dark; evidence: ${reportPath}`);
