# Generate chapter and action-dock final pass

The chapter status describes actual audio: Generated for a current recording, Older recording for
stale audio, To make when audio is missing, and No audio for an unavailable script chapter. Payment
presentation never creates an audio record or starts work. The host-confirmed current purchase scope
and current generated audio receive the gold wash, including selection; the redundant Purchased
badge is removed. Existing revision and ownership checks on the advisory host scope remain intact.

Phone rows reserve a wider title column, put chapter number and listening time in a compact second
row, and retain native whole-row selection plus an independent 44px Listen target. The action dock
sits 16px above the viewport foot, plus safe area. Short lists reserve remaining viewport space;
lists with more than three visible rows retain the compact sticky dock. Its size no longer
changes merely because the last row enters view, so the page height stays stable during scrolling. Generate clears the obsolete hidden mobile-navigation
padding, so its footer also stays near the bottom at the actual end of a long list.

The spacer measures document position. During shared modal scroll locking it uses the fixed body's
saved offset, so a viewport resize cannot reinterpret the frozen page as a different document
position. The Export dock and its shared hook are unchanged.

From `frontend`, run Storybook at port 6017, then:

```sh
npm run storybook -- --port 6017
GENERATION_REVIEW_URL=http://127.0.0.1:6017 node scripts/verify-generation-layout.mjs /tmp/meowdiobooks-generation-layout
GENERATION_REVIEW_URL=http://127.0.0.1:6017 node scripts/verify-generation-modal-return.mjs /tmp/meowdiobooks-generation-layout
```

The browser check uses synthetic Storybook gateways. It inspects the single completed chapter,
mixed purchased/audio states, and a 120-chapter list in Chromium and WebKit at 320, 390 and 1440px,
in light and dark. It verifies bottom placement, no horizontal overflow, gold selection, absence
of the Purchased badge, and access to the last chapter above the dock. The focused component
regression also proves a paid chapter without audio stays pending and cannot automatically generate
from the presentation prop.

This is rendered synthetic evidence, not payment-provider, backend-generation or physical-device
validation. Doubled text is a synthetic font-size check, not native browser zoom.

Final candidate evidence: 36/36 layout checks and 6/6 modal-return/resize/Chinese 200%
font-size checks passed. The included reports and selected PNGs are synthetic renders of the
production App composition. Production build, Storybook types and 181/181 focused Generate/App unit tests passed. Lint
retains one pre-existing LanguagePicker Fast Refresh warning. An earlier concurrent run timed
out under heavy host load; the final single-worker rerun passed in 10.45 seconds.

Release-preparation gates on the unchanged shared source, aligned at 0.1.48:

- `npm test -- --maxWorkers=2`: 370/370 tests passed.
- `npm run lint`, `npm run build`, `npm run storybook:check`: passed; existing LanguagePicker
  Fast Refresh and existing bundle-size warnings remain.
- `npm run test:consumer`: strict public types, host CSS precedence, handled/delegated/declined
  actions, six isolated modal cases and four App-to-public-UI handoffs passed in development
  and production where applicable.
- `npm run test-storybook -- stories/GenerationPurchase.stories.tsx`: both affected rendered
  browser/accessibility stories passed.
- Pinned Python 3.12 environment, `ruff check src/meowdiobooks tests`: passed.
- `PYTHONPATH=src:. pytest -q -m "not uses_audio_decoder and not runs_models"`: 513 passed,
  three native audio/model cases deselected. Backend processing and runtime dependencies are
  unchanged; model/audio and public-domain processing evaluations were not rerun for this
  presentation-only change.

The next version was checked against current remote main, tags and published releases before the
aligned metadata update. This record prepares a candidate; it does not claim merge, immutable
publication, companion adoption or deployment.
