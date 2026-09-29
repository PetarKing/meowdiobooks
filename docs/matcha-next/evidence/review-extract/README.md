# Review return and Extract page-height check

The Review return behavior was exercised in `frontend/src/App.test.tsx`: the first scan stays on the page, **Change settings** on an accepted Review starts a fresh unpublished candidate immediately, and a failed scan leaves an in-place retry. No accepted artifact changes before explicit Review acceptance. This matches the local `process_review` handler, which writes its result with `publish=False`.

Rendered fixture check:

```sh
node frontend/scripts/verify-review-extract.mjs http://127.0.0.1:5179/studio.html docs/matcha-next/evidence/review-extract
```

`report.json` records eight 1440px/390px light/dark Review and Extract views: zero page overflow, runtime errors, real API requests or axe violations. The accepted Review fixture reached its decision workspace with one **Change settings** click and no extra scan button. The screenshots show the initial Review scene and Extract source page at both sizes.

For a non-fixture PDF page shape, page 1 of `SampleBooks/public-domain-evaluation/01-alice-explicit-dialogue.pdf` was rasterized with Poppler and injected into the synthetic Extract UI. Its 700×993px image rendered at 514×729px on desktop and 324×460px on phone. The image bottom remained 17px above the paper bottom, and each paper pane's scroll height equaled its client height. The complete page is visible in `alice-page-extract-1440-light.png` and `alice-page-extract-390-light.png`. This verifies the browser layout with a real public-domain page, not the parser or server job lifecycle; no backend extraction or model work was run for this UI change.
