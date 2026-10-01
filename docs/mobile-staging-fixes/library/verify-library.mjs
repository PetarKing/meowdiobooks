import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const frontend = `${root}/frontend`;
const evidence = fileURLToPath(new URL("./evidence/", import.meta.url));
const phase = process.argv.includes("--before") ? "before" : "after";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const baselineRevision = "c02cc28e7713c02958755f26d3771c824fa3f6b8";
const reviewScreenshots = new Set([
  "before-chromium-populated-320-light", "after-chromium-populated-320-light",
  "before-chromium-populated-1024-light", "after-chromium-populated-1024-light",
  "before-chromium-populated-1920-dark", "after-chromium-populated-1920-dark",
  "after-chromium-populated-390-dark",
  "before-chromium-hosted-390-dark", "after-chromium-hosted-390-dark",
  "after-chromium-long-320-dark", "after-chromium-missing-320-light",
  "after-webkit-populated-320-light", "after-webkit-populated-1920-dark",
]);
const require = createRequire(`${frontend}/package.json`);
const { build } = require("esbuild");
const { chromium, webkit } = require("playwright");
await mkdir(evidence, { recursive: true });
const source = `
import {createRoot} from 'react-dom/client';
import App from '${frontend}/src/App';
import '${frontend}/src/i18n';
import '${frontend}/src/styles/product.css';
import {createFixtureGateway} from '${frontend}/design-kit/fixtures';
const query=new URLSearchParams(location.search),kind=query.get('kind')||'populated';
const scenario=kind==='loading'?'library-loading':kind==='error'?'library-error':kind==='empty'?'library-empty':kind==='missing'?'library-missing-cover':'library';
const gateway=createFixtureGateway(scenario), originalList=gateway.listLibrary;
if(['single','long','hosted'].includes(kind))gateway.listLibrary=async()=>{
  const editions=await originalList();
  if(kind==='single')return [editions[0]];
  return [...editions,
    {...editions[0],id:'long-edition',title:'Alice’s Adventures in Wonderland — The Complete Unabridged Illustrated Edition with a Very Long Subtitle',author:'Lewis Carroll · SyntheticEditorialIdentifierWithoutAnySpacesToExerciseAuthorWrapping',partial:true,chapterPositions:[1,2,5,9,10],chapterCount:5},
    {...editions[0],id:'chinese-edition',title:'爱丽丝梦游仙境：月光下的奇妙冒险与不可思议的漫长故事',author:'刘易斯·卡罗尔',partial:true,chapterPositions:[3,4,7,8,13],chapterCount:5}
  ];
};
const hosted=kind==='hosted';
createRoot(document.getElementById('root')).render(<App gateway={gateway} appearance={query.get('appearance')==='light'?'light':'dark'} renderLibraryActions={hosted?()=> <button className='primary'>Download</button>:undefined}/>);
`;
const compiled = await build({
  stdin: { resolveDir: frontend, loader: "tsx", contents: source },
  bundle: true, write: false, outfile: "/private/tmp/library-responsive-fixture.js", jsx: "automatic",
  loader: { ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff2": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  plugins: phase === "before" ? [{ name: "reviewed-baseline-library-css", setup(builder) {
    builder.onLoad({filter: /\/src\/styles\/pages\.css$/}, () => ({
      contents: execFileSync("git", ["show", `${baselineRevision}:frontend/src/styles/pages.css`], {cwd: root, encoding: "utf8"}),
      loader: "css", resolveDir: `${frontend}/src/styles`,
    }));
  }}] : [],
});
const js = compiled.outputFiles.find(file => file.path.endsWith(".js")).contents;
const css = compiled.outputFiles.find(file => file.path.endsWith(".css")).contents;
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const paths = new Set();
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  paths.add(pathname);
  response.setHeader("content-type", pathname === "/fixture.js" ? "text/javascript" : pathname === "/fixture.css" ? "text/css" : "text/html");
  response.end(pathname === "/fixture.js" ? js : pathname === "/fixture.css" ? css : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await (engine === "webkit" ? webkit : chromium).launch({headless: true});
const observations = [];
try {
  const widths = engine === "webkit" ? [320,390,550,551,700,701,750,751,1011,1012,1920] : [320,390,550,551,700,701,750,751,768,930,1011,1012,1024,1440,1920];
  const cases = widths.flatMap(width => ["light","dark"].map(appearance => ({width,appearance,kind:"populated"})));
  if (phase === "before") for (const width of [320,390,768,1440,1920]) for (const kind of ["single","hosted"]) cases.push({width,appearance:"dark",kind});
  if (phase === "after") {
    for (const width of [320,390,768,1024,1440,1920]) for (const kind of ["single","long","hosted"]) cases.push({width,appearance:"dark",kind});
    for (const width of [320,751,1920]) for (const kind of ["empty","loading","error","missing"]) cases.push({width,appearance:"light",kind});
  }
  for (const {width,appearance,kind} of cases) {
    const context = await browser.newContext({viewport: {width,height:900},deviceScaleFactor:1,locale:"en-GB",reducedMotion:"reduce"});
    const page = await context.newPage(), errors = [], externalRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {if(!request.url().startsWith(origin)&&!request.url().startsWith("data:"))externalRequests.push(request.url());});
    await page.goto(`${origin}/library?appearance=${appearance}&kind=${kind}`);
    await page.getByRole("heading", {name:"Your audiobooks",exact:true}).waitFor();
    if(kind==="loading") await page.getByRole("status",{name:"Loading audiobooks"}).waitFor();
    else if(kind==="empty") await page.getByRole("heading",{name:"No audiobooks yet.",exact:true}).waitFor();
    else if(kind==="error") await page.getByRole("alert").waitFor();
    else await page.locator(".library-book:not(.library-skeleton)").first().waitFor();
    await page.evaluate(async()=>{await document.fonts.ready; await Promise.all(Array.from(document.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;})));});
    const geometry = await page.evaluate(() => {
      const bounds = node => {if(!node)return null; const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const library = document.querySelector(".library-page"), head = document.querySelector(".library-head"), grid = document.querySelector(".library-grid");
      return {
        viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
        workspace:bounds(document.querySelector(".workspace")),main:bounds(document.querySelector("main")),library:bounds(library),header:bounds(head),grid:bounds(grid),
        headerToGrid:grid?grid.getBoundingClientRect().top-head.getBoundingClientRect().bottom:null,
        editions:Array.from(document.querySelectorAll(".library-book")).map(article=>({
          edition:bounds(article),cover:bounds(article.querySelector(".library-cover")),copy:bounds(article.querySelector(".library-book-copy")),title:bounds(article.querySelector("h2")),author:bounds(article.querySelector(".library-book-copy > p")),meta:bounds(article.querySelector(".library-meta")),actions:bounds(article.querySelector(".library-actions")),
          controls:Array.from(article.querySelectorAll("button,a")).map(node=>({label:node.textContent?.trim(),...bounds(node)})),
          overflows:Array.from(article.querySelectorAll("h2,p,.library-chapters,.library-meta,.library-actions")).filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({class:node.className,tag:node.tagName,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth})),
        })),
      };
    });
    const screenshotName = `${phase}-${engine}-${kind}-${width}-${appearance}`;
    if(reviewScreenshots.has(screenshotName))await page.screenshot({path:`${evidence}/${screenshotName}.png`,fullPage:true});
    assert.equal(errors.length,0,errors.join("\n"));
    assert.equal(externalRequests.length,0,"Fixture made an external request");
    // The baseline may fail the deliberate uninterrupted-author stress case;
    // retain that measured failure as evidence rather than aborting its capture.
    if(phase==="after" || !["long","hosted"].includes(kind))assert.ok(geometry.documentWidth<=width && geometry.bodyWidth<=width,`${kind}/${width}: horizontal page overflow`);
    if(phase==="after")for(const edition of geometry.editions){
      assert.deepEqual(edition.overflows,[],`${kind}/${width}: edition text/action overflow`);
      assert.ok(edition.edition.x>=geometry.library.x-1 && edition.edition.right<=geometry.library.right+1,`${kind}/${width}: edition escaped Library`);
      assert.ok(edition.cover.right<=edition.copy.x-12,`${kind}/${width}: cover/text separation`);
      for(const control of edition.controls)assert.ok(control.height>=44 && control.x>=edition.edition.x-1 && control.right<=edition.edition.right+1,`${kind}/${width}: unreachable action ${control.label}`);
    }
    observations.push({width,appearance,kind,geometry,errors,externalRequests});
    await context.close();
  }
  const sourceHash = createHash("sha256").update(phase==="before"?execFileSync("git",["show",`${baselineRevision}:frontend/src/styles/pages.css`],{cwd:root}):await readFile(`${frontend}/src/styles/pages.css`)).digest("hex");
  await writeFile(`${evidence}/${phase}-${engine}-geometry.json`, JSON.stringify({capturedAt:new Date().toISOString(),baselineRevision,phase,engine,sourceHash,fixture:"Full production App and canonical product.css with local synthetic gateway only; no staging/account/provider access. Hosted action uses the public renderLibraryActions slot.",requestPaths:[...paths],observations},null,2)+"\n");
  console.log(JSON.stringify({phase,engine,cases:observations.length,overflowCases:observations.filter(row=>row.geometry.documentWidth>row.width).length,sourceHash},null,2));
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
