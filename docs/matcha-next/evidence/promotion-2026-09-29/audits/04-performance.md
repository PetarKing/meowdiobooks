# Studio performance, dependencies and motion audit — 2026-09-29

Reviewer: independent auditor 04. Scope: production bundle, assets, import/loading boundaries, animation properties and reduced-motion behavior. Implementation and Git state are read-only for this audit.

## State and decision

Static inspection completed against committed Studio `9545014c8100f1e286baddc7a935c99145bffa8b` while the `590bcd4` merge was unresolved. After the parent confirmed that frontend conflicts were resolved, the integrated source passed a production build. The resulting source revision is `4c8038470c052e09b229c8b00648ce041933689f`. Build hashes and exact byte counts are recorded in [04-production-assets.json](04-production-assets.json).

**No proven performance blocker was found.** The build emits Vite's warning for an unsplit JavaScript chunk exceeding 500 kB after minification. The remaining optimization opportunities are the eager initial bundle, the Home artwork/header mark, and permanent paint-affecting canopy motion. These are follow-up risks, not demonstrated latency or frame-rate failures. No product performance budget was supplied, and no hosted load benchmark was performed.

## Observed source facts

- `package.json` and the installed direct dependency tree contain React, React DOM, i18next/react-i18next, and build tools. Three, `@react-three`, SoundField, GSAP and Framer Motion are absent. A committed-source search found no Canvas/WebGL implementation. No install or network dependency audit was performed.
- `App.tsx` imports all nine page modules synchronously. No runtime `import()` or React lazy boundary occurs in application source. The public application loads the complete English/Chinese i18n initialization synchronously; `zh-CN.ts` is 84,796 source bytes. Type-only `import()` expressions in contracts do not create runtime chunks.
- The canonical `product.css` eagerly imports the inherited baseline/media sheets and all Studio/domain sheets. This order preserves ordinary host overrides, as required by the architecture and stylesheet ownership docs. Removing inherited declarations is a consumer migration, so this audit does not recommend casual deduplication.
- Fonts use local system stacks. There is no font CDN URL or `@font-face` in production HTML/styles. Browser transfer evidence is still required to confirm the final runtime request set.
- Library covers use `loading="lazy"`. Home's decorative sanctuary image is eager with `fetchPriority="high"`, and CSS reserves its 3:2 ratio. Native audio elements use `preload="metadata"`; Cast uses one tile audio element and one candidate element rather than one element per card. Object URL and playback cleanup are present.
- The floating action dock schedules at most one requestAnimationFrame per event burst, uses a passive scroll listener, and cleans up listeners/observer/frame. Cast drag auto-scroll runs a frame loop only while an active drag is near an edge and cancels it on cleanup. No general idle JavaScript animation loop was found.

## Asset inventory at the committed source

| Asset | Raw bytes | Production reference |
| --- | ---: | --- |
| `matcha-kami-sanctuary.webp` | 539,118 | Home hero and empty Library illustration; 1536×1024 |
| `sanctuary-canopy.webp` | 299,380 | CSS background on every non-Home workspace |
| `meowdiobooks-mark.png` | 174,333 | Header mark; 512×512 rendered at about 45×45 on desktop |
| `meowdiobooks-hero.png` | 1,944,538 | No committed import/CSS URL found |
| `cat-wizard-workflow.png` | 519,429 | No committed import/CSS URL found |

The two unused historical images remain within the public source package's `src` allowlist. The production output proves that neither ships in the compiled application. The high-resolution mark is a possible download optimization; the rendered identity must be preserved.

## Motion inspection

`atmosphere.css` animates the main element's `background-position` continuously, shifting the decorative canopy 3px horizontally and 2px vertically over 18 seconds. `background-position` is a paint-affecting property; the source proves a permanent animation declaration, while actual paint frequency, battery use and dropped frames remain unmeasured. Its reduced-motion media query sets `animation: none`.

Roster hover/focus has finite opacity/transform transitions plus paint-affecting `background-position` and SVG stroke-dashoffset. Voice playback adds seven transform-scaled bars, an opacity/scale bloom, and SVG stroke-width/fill pulses. The SVG pulses require paint; they apply to the active playback tile. A short reveal also animates blur. The motion stylesheet explicitly disables animations, transitions and transforms for all these selectors in reduced-motion mode.

The inherited baseline contains a global reduced-motion fallback setting animation duration and transition duration to .01ms, animation iterations to one, and scroll behavior to auto, plus targeted shimmer suppression. Dedicated Studio rules disable the hero hover scale, upload/icon transitions, inspector animations, canopy motion and playback bars. The available browser API has no reduced-motion emulation capability, and the actual browser reports `prefers-reduced-motion: false`. Reduced-motion suppression is therefore source-verified, not runtime-verified. A subsequent browser/hardware check must establish that canopy, idle roster, active audition bars, SVG pulses, bloom and hover/focus drawing stop in reduced-motion mode without losing playback/status meaning.

## Executed production measurements

`npm run build` completed with exit 0: TypeScript succeeded, Vite 6.4.3 transformed 121 modules, and the bundling phase took 1.89 seconds on this machine. The full command took approximately five seconds. Build time is a local observation, not an end-user load benchmark.

| Compiled asset | Raw bytes | Gzip level 6 bytes |
| --- | ---: | ---: |
| Single initial JavaScript chunk | 586,731 | 179,563 |
| Single initial CSS bundle | 358,124 | 58,563 |
| Sanctuary Home illustration | 539,118 | Already compressed image; transport encoding unmeasured |
| Canopy illustration | 299,380 | Already compressed image; transport encoding unmeasured |
| Header mark | 174,333 | Transport encoding unmeasured |
| Favicon | 30,971 | Transport encoding unmeasured |
| HTML | 569 | 367 |

All emitted files total 1,989,226 raw bytes; initial JavaScript plus CSS totals 238,126 gzip bytes. This is an output inventory, not a claim that every image is requested in every view. CSS is large because the canonical product entry includes public inherited styles plus the approved Studio overrides. The inherited public CSS remains because legacy exports and host cascade priority are contracts. Gzip reduces its transfer to 58,563 bytes, but parse/style-matching costs were not measured. Arbitrary stylesheet deletion or reordering is not justified by the bundle size alone.

The clean-source `npm pack --dry-run --json --ignore-scripts --cache /private/tmp/meowdiobooks-audit04-npm-cache` measured a 3,686,797-byte tarball estimate, 4,421,101 unpacked bytes and 87 entries. It contains the five source images, including 2,463,967 bytes of unused historical imagery, and no Storybook, design-kit, test, script or dependency files. No tarball was created or published.

## Executed browser observations

Used one newly created background CUA tab on the parent's existing `http://127.0.0.1:5181/studio.html` development server. No parent/user tab or browser viewport setting was changed. The actual measured CSS viewport was 1422×800 with DPR approximately 1.8; this is the observed viewport, not a nominal 1440×900 assertion.

- **Home:** header mark and sanctuary image were complete. The mark's natural 512×512 pixels rendered at about 45×45 CSS pixels. The sanctuary's natural 1536×1024 pixels rendered at about 721×481 CSS pixels, with computed aspect ratio `3 / 2` and `fetchPriority="high"`. Its only computed motion was a finite `transform 0.7s` hover transition.
- **Observed assets:** Home inventory showed 81 development script resources, six stylesheet resources, zero fonts and four image inventory entries representing two images plus Vite import stubs. All observed resource URLs were same-origin localhost; no external assets were observed. These development module counts do not describe the production bundle's single chunk.
- **Generate:** the computed main animation was `sanctuary-canopy-sway`, 18 seconds, infinite. Its computed background position had reached approximately `calc(100% - 2.996px) 1.997px`, proving that the motion was running. The canopy appeared as an observed CSS background resource. No other element animation was active in the idle Generate sample.
- **Idle Voices:** the only computed animation was the canopy; no card/pseudo-element animation was active. There was one audio element, no assigned source before playback, no autoplay and no canvas.
- **Narrator preview playing:** the UI changed to “Stop Narrator preview”. Computed animation declarations were seven transform waveform bars, four SVG paths (two field fill pulses and two curve stroke pulses), one pseudo-element bloom, one short reveal, plus the canopy. This observed scope confirms playback motion is confined to the active tile rather than all seven idle tiles. The assigned audio element retained `preload="metadata"`. This synthetic WAV interaction was a motion check, not a provider audition or listening-quality test.

CUA read-only evaluation does not expose `performance.getEntriesByType`; attempting resource timing returned an unavailable API error. The advertised browser capabilities expose visibility and viewport, but no network timing, CPU tracing or media-preference emulator. No shell browser automation or OS preference change was used to circumvent those limits. Resource inventory and computed styles were observed; request durations, transfer sizes, compositor traces, dropped frames and live reduced-motion behavior remain unmeasured.

## Non-blocking follow-ups

1. Measure the permanent canopy on representative phone hardware. If it adds sustained paint cost, freeze it or move motion to a separately contained transform layer while preserving modal stacking and the approved artwork. Source and computed styles prove paint-affecting motion, not unacceptable battery/frame-rate impact.
2. Consider page/locale splitting if hosted cold-load metrics show a meaningful delay. The >500 kB warning and one eager chunk are proven; initial parse/interaction delays are not. Preserve current view mount boundaries and shared composition contracts.
3. Produce a smaller header-mark asset and responsive sanctuary variants only with rendered comparisons that preserve the approved art. The 512px mark is materially larger than its observed 45px display. Remove the two unused historical source images only after confirming no supported consumer references them; compiled-app transfer already excludes them.

## Boundaries and reproducibility

Executed source checks: `git show HEAD:<path>`, committed `git grep` for imports/assets/animation/reduced-motion/WebGL markers, `git ls-tree -r --long HEAD frontend/src frontend/public frontend/design-kit`, `npm --prefix frontend ls --omit=dev --depth=0`, and native file-format inspection. Built with `npm run build`, independently counted output bytes/gzip/SHA-256 with Python's standard library, and reran the clean-source package dry run. The JSON inventory records the exact revision and compression method. Normal-motion DOM/computed-style checks used CUA only.

The first `npm pack --dry-run` attempt hit the sandbox-protected default npm cache. A retry using `/private/tmp/meowdiobooks-audit04-npm-cache` succeeded without changing permissions or installing dependencies. Only the rerun after frontend conflict resolution is reported above.

Not established by this audit: provider/dependency vulnerability status, hosted Cloud load timing, browser request duration/transfer encoding, low-end hardware frame rate, mobile battery drain, or runtime reduced-motion suppression. It provides build/resource/motion evidence and identifies follow-up performance risks; it does not establish a universal performance guarantee.
