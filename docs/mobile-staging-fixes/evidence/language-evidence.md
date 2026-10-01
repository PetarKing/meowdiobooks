# Mobile narration-language regression

Original source revision: `e89137192435ad496230f8cf3ff1adec9f98ab36`. The after-state source is the working tree
candidate bound by `language-source-manifest.json` SHA-256 hashes.

`original-language-webkit.json` records an actual touch sequence in WebKit 26.6
with Playwright 1.63.0 iPhone 13 emulation: tap the original disclosure, then tap
French. The summary lost focus with no related target, the custom blur handler
closed the disclosure, and the synthesized click landed on the body. The selected
language remained empty. This reproduces the reported mobile language blocker
without a backend or unavailable-model condition.

`native-language-webkit.json` records the same source component after replacing
that disclosure with a styled native select: tap the control and select French
through the browser's native select automation. React receives French; an empty
language list disables the selector and shows a clear status; restoring the list
allows English. The control measures 48px tall with 16px text, and no page errors
were observed. `native-language-mobile-webkit.png` shows the selected state.

This verifies WebKit mobile emulation, not a physical iPhone Safari session.
Only synthetic language identifiers were used; no staging, account, book or paid
provider interaction took place.

## Full application verification

Run `node docs/mobile-staging-fixes/verify-casting-mobile.mjs` from the Core repo
after installing its locked frontend dependencies and Playwright WebKit runtime.
The script bundles the real App and current styles, serves an owned ephemeral
localhost origin, and injects a synthetic gateway with 60 cast identities. It
never requests the staging API or a provider. The script closes its browser and
HTTP server on completion or failure.

`casting-full-app-mobile-webkit.json` records the baseline commit and SHA-256
hashes for the candidate source used in the full application run. Both a normal
first quote and an intentional first-request HTTP 422 pass:

- A stale unbound draft model resolves to the available Studio model. Model
  choices remain visible after a quote rejection, with actionable validation
  detail for 422 responses.
- Moving from the bottom of the 60-identity Cast page (scrollY 6315) to Design
  resets scrollY to 0 and focuses main. Main has no visible outline, and the
  document has no horizontal overflow.
- Choosing French updates the native select immediately. Continue stays disabled
  during the new quote and becomes enabled after the matching French quote.
- There are no browser page errors or process-stage calls. Only `/`, `/audit.js`
  and `/audit.css` are requested from the owned local origin.

The full-page `casting-first-visit-mobile-webkit.png`,
`casting-validation-error-mobile-webkit.png` and
`casting-selected-language-mobile-webkit*.png` show the initial, failed-quote and
successful selection states. The final selected-language image was visually
inspected: header and mobile wizard navigation are in the expected order; the
picker, model options, price and enabled Continue are readable and unclipped.

The stale model trap is a secondary robustness issue, not evidence that the
staging book had a stale model. Current Cloud defaults and the identity proposer
are consistent in inspected source. `voiceSelection.test.ts` verifies that
generated audition bindings and matching recoverable jobs preserve their saved
model/language, while unrelated old attempts do not bind a fresh identity draft.
`CastingChoice.test.tsx` verifies failed-first-quote recovery, retry with cached
settings, and superseded success/failure isolation. These focused files and the
language picker tests pass 28 tests in total.
