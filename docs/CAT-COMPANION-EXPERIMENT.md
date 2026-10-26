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
