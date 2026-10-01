import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../..", import.meta.url)), frontend = `${root}/frontend`, evidence = `${root}/docs/mobile-staging-fixes/evidence`;
const require2 = createRequire(`${frontend}/package.json`), { build } = require2("esbuild"), { webkit, devices } = require2("playwright");
await mkdir(evidence, { recursive: true });
const compiled = await build({ stdin: { resolveDir: frontend, loader: "tsx", contents: `
import {createRoot} from 'react-dom/client';
import App from '${frontend}/src/App';
import '${frontend}/src/i18n';
import '${frontend}/src/styles/product.css';
import {createFixtureGateway,snapshotFor} from '${frontend}/design-kit/fixtures';
const snapshot=snapshotFor('cast-dense');
snapshot.castingPreviewAvailable=true;
snapshot.cast.voiceModel='retired-model';snapshot.cast.language='retired-language';
snapshot.cast.proposals=snapshot.cast.proposals.map(row=>({...row,reviewRequired:false,competingCandidates:[],canonicalName:row.label,aliases:[]}));
snapshot.voiceSelection={modelId:'retired-model',language:'retired-language'};
snapshot.voiceModels=[{id:'studio',label:'Studio',supportedLanguages:['english','french']},{id:'balanced',label:'Balanced',supportedLanguages:['english','french']}];
const gateway=createFixtureGateway('cast-dense');gateway.getBookSnapshot=async()=>structuredClone(snapshot);
const audit=window.__castingAudit={requests:[],processCalls:[]},processStage=gateway.processStage;
gateway.processStage=(...args)=>{audit.processCalls.push(args);return processStage(...args)};
const failStatus=Number(new URLSearchParams(location.search).get('quoteFailure'));
gateway.previewCasting=async(bookId,settings)=>{
audit.requests.push({bookId,settings});
if(audit.requests.length===1&&failStatus)throw Object.assign(new Error('Select a supported voice language'),{status:failStatus});
if(!snapshot.voiceModels.some(model=>model.id===settings.voiceModel&&model.supportedLanguages.includes(settings.language)))throw Object.assign(new Error('Select a supported voice language'),{status:422});
return {fingerprint:'synthetic-'+settings.language,sources:[],exactMatchCount:0,totalVoiceCount:61,remainingVoiceCount:61,currency:'USD',options:[{modelId:'studio',label:'Studio',description:'Higher-quality casting. A distinct voice for each character.',estimatedCostMinor:210},{modelId:'balanced',label:'Balanced',description:'Balances quality and cost. A distinct voice for each character.',estimatedCostMinor:110}]};
};
createRoot(document.getElementById('root')).render(<App gateway={gateway} appearance='dark'/>);
` }, bundle: true, write: false, outfile: "/private/tmp/casting-mobile-fixture.js", jsx: "automatic", loader: { ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
const code = compiled.outputFiles.find((file) => file.path.endsWith(".js")).contents, css = compiled.outputFiles.find((file) => file.path.endsWith(".css")).contents;
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/audit.css"></head><body><div id="root"></div><script src="/audit.js"><\/script></body></html>';
const paths = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  paths.push(path);
  if (path === "/") {
    response.setHeader("content-type", "text/html");
    response.end(html);
  } else if (path === "/audit.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(code);
  } else if (path === "/audit.css") {
    response.setHeader("content-type", "text/css");
    response.end(css);
  } else {
    response.statusCode = 404;
    response.end("Synthetic fixture: route unavailable");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await webkit.launch({ headless: true }), results = [];
try {
  for (const failStatus of [0, 422]) {
    const context = await browser.newContext({ ...devices["iPhone 13"], locale: "en-GB" }), page = await context.newPage(), pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(`${origin}/?quoteFailure=${failStatus}`);
    await page.getByRole("button", { name: /Alice.*Continue/ }).tap();
    await page.getByRole("heading", { name: "Build the cast." }).waitFor();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const initialScroll = await page.evaluate(() => window.scrollY);
    if (initialScroll < 500) throw new Error("Dense cast fixture was not a long scrollable page");
    await page.getByRole("button", { name: "Design the voices \u2192" }).tap();
    await page.getByRole("heading", { name: "Design the voices" }).waitFor();
    await page.waitForFunction(() => window.scrollY === 0 && document.activeElement?.tagName === "MAIN");
    const navigation = await page.getByRole("main").evaluate((node) => ({ scrollY: window.scrollY, mainFocused: node === document.activeElement, outlineStyle: getComputedStyle(node).outlineStyle, outlineWidth: getComputedStyle(node).outlineWidth, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth }));
    const language = page.getByRole("combobox", { name: "Narration language" });
    if (await language.isDisabled()) throw new Error("Fresh draft did not recover to an available model");
    if (failStatus) {
      await page.getByRole("alert").waitFor();
      if (!(await page.getByRole("alert").textContent()).includes("Select a supported voice language")) throw new Error("422 validation detail was lost");
      if (!await page.getByRole("button", { name: /^Balanced/ }).isEnabled()) throw new Error("Quote failure hid model choices");
      await page.screenshot({ path: `${evidence}/casting-validation-error-mobile-webkit.png`, fullPage: true });
    } else {
      await page.getByLabel("Estimated cost").waitFor();
      await page.screenshot({ path: `${evidence}/casting-first-visit-mobile-webkit.png`, fullPage: true });
    }
    const continueButton = page.getByRole("button", { name: "Continue \u2192" }), requiresExplicitLanguage = !await continueButton.isEnabled();
    await language.tap();
    await language.selectOption("french");
    const disabledWhileLanguageQuoteUpdates = !await continueButton.isEnabled();
    if (!disabledWhileLanguageQuoteUpdates) throw new Error("Language change retained an obsolete ready quote");
    await page.waitForFunction(() => window.__castingAudit.requests.at(-1)?.settings.language === "french" && document.querySelector(".casting-choice")?.getAttribute("aria-busy") === "false" && document.querySelector(".casting-footer > .primary")?.disabled === false);
    await page.screenshot({ path: `${evidence}/casting-selected-language-mobile-webkit${failStatus ? "-after-error" : ""}.png`, fullPage: true });
    const audit = await page.evaluate(() => window.__castingAudit), lastSettings = audit.requests.at(-1)?.settings;
    const languageStyle = await language.evaluate((node) => ({ height: node.getBoundingClientRect().height, fontSize: getComputedStyle(node).fontSize, backgroundImage: getComputedStyle(node).backgroundImage }));
    results.push({ failStatus, initialScroll, navigation, requiresExplicitLanguage, disabledWhileLanguageQuoteUpdates, selectedLanguage: await language.inputValue(), continueEnabled: await continueButton.isEnabled(), lastSettings: { ...lastSettings, identityDecisions: lastSettings?.identityDecisions?.length }, requestCount: audit.requests.length, processCallCount: audit.processCalls.length, languageStyle, pageErrors });
    if (!requiresExplicitLanguage || lastSettings?.voiceModel !== "studio" || lastSettings?.language !== "french" || audit.processCalls.length || pageErrors.length || navigation.outlineStyle !== "none" || navigation.horizontalOverflow) throw new Error("Mobile casting regression assertion failed");
    await context.close();
  }
  const sourceFiles = ["frontend/src/App.tsx", "frontend/src/app/usePageNavigation.ts", "frontend/src/app/useWorkflowModel.ts", "frontend/src/pages/CastPage.tsx", "frontend/src/components/CastingChoice.tsx", "frontend/src/components/CastingChoice.css", "frontend/src/components/LanguagePicker.tsx", "frontend/src/components/LanguagePicker.css", "frontend/src/workflow/voiceSelection.ts", "frontend/src/styles/product.css", "frontend/src/styles/pages.css"], hashes = {};
  for (const file of sourceFiles) hashes[file] = createHash("sha256").update(await readFile(`${root}/${file}`)).digest("hex");
  const report = { capturedAt: (/* @__PURE__ */ new Date()).toISOString(), baselineRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), candidateSourceSha256: hashes, engine: "WebKit26.6 revision2359 / Playwright1.63.0", profile: devices["iPhone 13"], fixture: "Real App with injected synthetic60-identity gateway; all provider/backend methods remain local synthetic functions", results, requestPaths: [...new Set(paths)] };
  await writeFile(`${evidence}/casting-full-app-mobile-webkit.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ results, requestPaths: report.requestPaths }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
