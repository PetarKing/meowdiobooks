# Reading cat on Home and Library

Local experiment requested after merging the agent guide. Base: workflow 0.1.75,
`fc74a1250c38f933250c841a999d0405d1758d42`. Branch: `codex/cat-home-experiment`.

The reusable visual contract belongs in core: Home, empty Library and populated Library use the
same reading-cat SVG as the guide. Cloud policy, configuration and customer data are outside this
experiment. No workflow state, import, payment or generation behavior changes.

Home replaces the static sanctuary image with a large breathing/blinking cat. The empty Library
uses a matching companion; a populated Library keeps a small, still, sleepy cat beside the heading. Animation
can be paused, stops in hidden tabs, respects reduced motion and uses CSS transforms/opacity.
The SVG is lazy loaded; no new runtime dependency or animation frame loop is added.

Preview with synthetic data: `npm --prefix frontend run dev -- --mode studio --host 127.0.0.1 --port 5213 --strictPort`,
then open `http://127.0.0.1:5213/studio.html`. The preview selector includes Home, empty Library,
populated Library and other real workflow surfaces. This experiment is for review, not merged or
published as a workflow release.

Validation on macOS arm64 / Node 22.23.4: production build, ESLint and 209 existing guide/App
tests passed. Existing fast-refresh warnings and bundle-size advisories remain. The extracted
illustration is a 5.54 KB / 2.03 KB gzip lazy chunk; the 539 KB sanctuary image is no longer
referenced by Home or the empty Library. This is a bundle observation, not a frame-time benchmark.
The SVG reserves its aspect ratio before loading.

Browser review covers desktop light/dark Home, empty and populated Library, and 390-pixel
Home/Library layouts with no horizontal overflow. The pause button changes motion state, the
tail transform advances during playback, and populated Library motion stays paused. Reduced
motion is handled in CSS. Screenshots in `assets/review/cat-companion/` use synthetic data.

## Three immersive Home directions

Requested follow-up: increase the desktop scale and add the guide's background-wide effects.
All three now fill the viewport with SVG scenery, rather than putting a small illustration in
the hero grid. The neutral visual context is confined to this experiment; it carries no commands.
The design-preview buttons change only presentation, preserving the active workflow state.

- [01 · Wide sky](http://127.0.0.1:5213/studio.html?cat=wide-sky): large cat on the right,
  sweeping dither ribbons, stars and floating sheets across the page.
- [02 · Moonrise](http://127.0.0.1:5213/studio.html?cat=moonrise): closer cat portrait,
  oversized cherry moon, orbital lines and a quiet surface around the import controls.
- [03 · Storybook](http://127.0.0.1:5213/studio.html?cat=storybook): scene on the left,
  import on the right, and an open-book landscape spanning the bottom of the page.

The book shelf uses a readable surface over the background. Library retains the earlier treatment.
All motion shares the pause control, hidden-tab pause and reduced-motion behavior. No new runtime
dependency, canvas, WebGL or frame loop is used. The scene and shared illustration load lazily.

Validation: build, lint, 209 guide/App tests and Storybook/preview types passed. Existing warnings
remain. Browser evidence in `assets/review/cat-companion/versions/` covers all three directions
at 1920×1080 light/dark and 390×844 dark, plus Wide sky at 2560×1440. No horizontal overflow;
the phone text begins above the cat; pause stops background stars and the cat's tail together.

## Sanctuary hybrid and actual dithercn comparison

Latest direction keeps the original sanctuary illustration, typography and import flow. The extra
reading-cat SVG is absent. The image and text scale with the desktop, while compact Home brings
the book shelf higher and includes the real standalone footer in the synthetic preview. One book
fits with the footer at 1280×720 and 1920×1080; six books scroll naturally. Phones use normal
vertical flow. The visible pause control was removed at the user's request; reduced-motion and
hidden-tab behavior remain.

- [dithercn](http://127.0.0.1:5213/studio.html?cat=hybrid-dithercn) uses the actual upstream
  Waves component and DitherShader engine, installed as plain source from commit
  `10d7af5ce9b044e82345ae89bf78631845810821`. MIT license and integration adjustments are documented
  in `frontend/src/lib/dithercn/README.md`. One context, 3px cells, 20fps cap. The lazy engine adapter
  is approximately 13 KB gzip, with no new npm runtime dependency. It has upstream WebGL fallback,
  resize/offscreen management and motion handling. A measured mask clears the copy and controls.
- [Custom SVG](http://127.0.0.1:5213/studio.html?cat=hybrid) uses continuous wind/water contours
  animated by CSS. Its lazy atmosphere module is approximately 1.42 KB gzip.

Both share a small SVG layer of sakura petals, flowers, musical notes and sparkles, with static
blur on individual distant glyphs and sharper foreground elements. No full-viewport blur is used.
The product visual contract and neutral preview live in core; no Cloud policy or credentials enter
this experiment. Earlier cat directions remain available by their direct URLs and preserved commits.

Validation: production build, ESLint, 209 guide/App tests and Storybook/preview types passed.
An initial headless test run exposed missing browser observer/media APIs; the adapter now uses a
static fallback when these APIs are absent. A full focused rerun passed. Existing lint warnings
and large-chunk advisories remain. Browser review covers both alternatives in desktop/phone,
light/dark, footer visibility, no horizontal overflow, and six-book flow. Chrome DevTools actual
reduced-motion emulation produced `data-state="static"` and `animation-name: none` for particles;
the emulation was restored afterward. Shader state normally reports `running`; there are no
dither-engine console errors. Screenshots are under `assets/review/cat-companion/hybrid/`.

This is a local visual comparison, not a release or deployment. Bundle size and the frame-rate cap
are observations; no frame-time or power-use benchmark is claimed.

## Custom atmosphere refinement and empty Library

The user selected the custom SVG direction; it is now the default. The dithercn comparison remains
available at its explicit URL. Upper contours have tapered spacing, a fading green-to-pink stroke,
and a broader, gently rotating 22-second drift. The dark book shelf uses a 72% canvas wash; the
light shelf uses a 32% soft-surface wash. Light Choose book is a modest paper/soft-surface blend.
The light book cards retain their existing opaque paper background.

The empty Library now uses the Home proportions: a small Your audiobooks label, one heading,
one existing explanatory sentence, and the existing create action beside the larger reading cat.
There is no additional top heading or pause control. The shared SVG atmosphere supplies wind/water,
petals, notes and sparkles across the viewport. Its styles load with the lazy SVG, so direct Library
entry also animates correctly. Populated Library keeps the small, still cat and no ambient layer.
The reusable core UI owns these changes; no hosted policy or Cloud-only overrides are involved.

Direct review: [Home](http://127.0.0.1:5213/studio.html?cat=hybrid) and
[empty Library](http://127.0.0.1:5213/studio.html?cat=hybrid&scenario=library-empty).
The synthetic preview now accepts a validated scenario query for these review links.

Validation: production build, lint (two existing Fast Refresh warnings), 209 guide/App tests, and
Storybook/preview types passed. Three existing empty-Library navigation assertions and the preview
scenario now target its single empty-state heading. Browser review covered 1280×720 and 1920×1080,
light/dark, 390px phone flow with no horizontal overflow, and the quiet populated Library. Empty
Library and one-book Home fit the desktop footer. Sampled wind transforms changed during review;
no browser console errors were captured. Hidden-tab and reduced-motion CSS handling remain.
The shared lazy atmosphere is 1.54 KB gzip plus 0.67 KB CSS in this build; no new runtime dependency.
Screenshots are retained in `assets/review/cat-companion/refinement/`. This remains a local,
unmerged visual experiment.

## First-visit readiness and collection-size review

The shared atmosphere and reading-cat SVG now load with the application rather than separate lazy
chunks. They render synchronously on a Library mount, avoiding the empty artwork frame on first
navigation. Optional dithercn and earlier sky alternatives remain lazy. This changes reusable core
presentation only; no Cloud credentials, provider operations, or hosted overrides are involved.
The production entry grew about 3.1 KB gzip, while the two art chunks and separate atmosphere CSS
request disappeared. This is an asset-readiness tradeoff, not a measured frame-time improvement.

The standalone and synthetic preview shells now use the same full-height flex layout and compact
footer for empty and populated pages. Previously, at a 933px viewport, Home ended at 933px but the
populated Library ended at 1078px. Afterward both ended at 933px in an actual Home-to-Library
navigation, with the cat SVG already present. A stable scrollbar gutter also avoids a width jump
when a collection requires scrolling. Artwork aspect-ratio reservations remain.

Six collection presets are first in the Preview menu: Home and Library with 0, 2, or 12 items.
Each uses a consistent in-memory collection for both product tabs, so switching between Create and
Library preserves the chosen density. Long titles, multilingual titles, partial exports and several
synthetic cover colors are represented. Selecting a preset updates the review URL; workflow
navigation remains contained within the preview. The page title identifies the selected preset.

At 1440×900, all four empty/few states end at 900px. The 12-item Home scrolls to 1294px and Library
to 1748px; all six have 1440px document width. The large collections were also reviewed in dark mode
and at 390px, where both contain 12 cards with no horizontal overflow. Exact desktop measurements
and screenshots are under `assets/review/cat-companion/collections/`. The browser console had no
captured errors. Browser viewport overrides were reset after review.

Validation: production build, lint (two existing Fast Refresh warnings), Storybook/preview types,
and 214 App/guide/fixture tests passed. No backend or provider behavior changed. This remains a
local, unmerged experiment.

## Mobile Home and shared empty-state alignment

The earlier shell change aligned the footer, but Home and Library still centered their copy against
different artwork heights. Empty Home and Library now share a layout contract for their label,
heading, description, mobile action reservation, and page height. Text anchors match exactly at
390, 750, 768, 1280, 1440 and 1920px widths in the retained measurements. Mobile artwork slots also
begin at the same position; desktop illustrations keep their own proportions. Both empty footers
match at every sampled viewport. Standalone height budgeting excludes the preview toolbar; only
the preview supplies its additional height through a CSS custom property.

Populated mobile Home keeps the sanctuary image as a shallow landscape strip. Its heading/import
spacing is tighter, and the layout breakpoint matches the product's 750px mobile navigation. On a
390×844 preview, the first card starts at 724px instead of 891px, and ends at 840px. The screenshot
includes the 109px synthetic preview toolbar; the actual product has no such toolbar. Empty Home
retains the more immersive illustration. Existing book-card styling and desktop populated Home
remain unchanged.

Browser review covered empty, 2-book and 12-book Home at 320, 390 and 750px, plus the paired empty
pages at six phone/tablet/desktop sizes. No horizontal overflow or captured console errors. Both
light and dark phone views were inspected. Screenshots and numeric evidence are under
`assets/review/cat-companion/mobile-alignment/`. Viewport overrides were reset. These reusable UI
changes remain in core, with no Cloud overrides, provider behavior, or new runtime dependency.

Validation for this refinement: production build, lint (the same two existing Fast Refresh warnings),
Storybook/preview types, and 214 App/guide/fixture tests passed. The final 1280×720 check still places
both empty headings at 248.39px and both footers at 720px after separating preview spacing from
standalone styling. Both in-app empty presets were refreshed. This remains local and unmerged.
