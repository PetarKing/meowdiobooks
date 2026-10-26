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
