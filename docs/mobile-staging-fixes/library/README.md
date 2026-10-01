# Responsive Library spacing verification

The Library keeps the open cover-and-bibliography composition while giving small
screens more room for titles and large screens a bounded reading width. Runtime
changes are confined to Library selectors in `frontend/src/styles/pages.css`.
No page markup, content, gateway, or workflow contract changed.

The page caps at 1160px and each edition at 560px. Covers scale from 84–120px on
phones and use 128px on desktop. Local actions sit beneath the full edition through
550px and beside the bibliography above that width. A 430px minimum grid track
allows two editions at 1024px without squeezing the local Open/Reveal controls.
Header-to-edition spacing is consistent on either side of 700px. Author strings
can wrap even when they contain no spaces.

These are local synthetic fixtures of the full production `App`, its actual
workspace/main container, and canonical `product.css`. The hosted case uses the
public `renderLibraryActions` slot with one Download button. The script bundles
in memory, serves only localhost, and asserts that no external request occurs.
This evidence does not claim remote staging or deployed-host verification.

## Measured geometry

All dimensions are CSS pixels, light appearance, populated two-edition fixture.

| Viewport | Before edition width | After edition width | Before text width | After text width | Before → after header/grid gap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 320 | 288 | 288 | 162 | 188 | 34 → 24 |
| 390 | 358 | 358 | 232 | 248.4 | 34 → 24 |
| 768 | 656 | 560 | 498 | 412 | 38 → 28 |
| 1024 | 912, one column | 436, two columns | 754 | 288 | 38 → 28 |
| 1440 | 644 | 560 | 486 | 412 | 38 → 28 |
| 1920 | 664 | 560 | 506 | 412 | 38 → 28 |

At 320px the selected edition title takes three lines rather than five. At 1920px
the page width is 1160px rather than 1368px. The uninterrupted-author stress fixture
made the baseline document 545px wide at both 320px and 390px viewports; the updated
layout fits the respective viewport widths.

## Evidence and reproduction

From the repository root:

```sh
node docs/mobile-staging-fixes/library/verify-library.mjs --before
node docs/mobile-staging-fixes/library/verify-library.mjs
node docs/mobile-staging-fixes/library/verify-library.mjs --webkit
```

`--before` substitutes the Library-owning page stylesheet from immutable baseline
`c02cc28e7713c02958755f26d3771c824fa3f6b8`. The normal command uses the current source.
It keeps baseline failures in the deliberate author stress case as measured evidence.
The final page-styles SHA-256 is
`38b946aa5dbc9d6931a0df63e836f3789696b5f4014d585dc4d6696140859757`.

- `evidence/before-chromium-geometry.json`: 40 baseline cases.
- `evidence/after-chromium-geometry.json`: 60 cases, Chromium 153.0.8010.12.
- `evidence/after-webkit-geometry.json`: 52 cases, WebKit 26.6.
- Curated PNG pairs show local editions at 320/light, 1024/light and 1920/dark,
  and hosted Download at 390/dark. Additional PNGs show local 390/dark, multilingual
  long-title/author wrapping at 320/dark, missing cover at 320/light, and WebKit at
  320/light and 1920/dark.

Chromium populated widths: 320, 390, 550, 551, 700, 701, 750, 751, 768, 930, 1011,
1012, 1024, 1440 and 1920, in both appearances. WebKit populated widths: 320, 390,
550, 551, 700, 701, 750, 751, 1011, 1012 and 1920, in both appearances. Extra cases
cover one edition, long English/Chinese titles, uninterrupted author text, partial
chapter ranges, hosted actions, and representative empty/loading/error/missing-cover
states. Geometry assertions check document/element overflow, cover-to-text separation,
edition containment, and action bounds with at least 44px height. Final Chromium and
WebKit cases all passed with zero page errors, external requests or overflow.

Rendered review inspected the main widths and both appearances, including the
930px single-column gap, the 1011/1012px two-column transition, and WebKit phone layout.

## Existing checks

```sh
npm --prefix frontend test -- src/App.test.tsx tests/library-card-css.test.mjs tests/mobile-workflow-layout-css.test.mjs
npm --prefix frontend run build
npm --prefix frontend run lint
git diff --check
```

144 existing tests passed. Build and lint passed; they retain the existing large
JavaScript chunk notice and the existing `LanguagePicker.tsx` fast-refresh export
warning. No Stylelint configuration is present. No implementation-mirroring tests
were added. No commit, push, merge, release or deployment was performed in this work.
