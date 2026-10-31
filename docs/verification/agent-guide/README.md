# Browser agent guide — verification, 26 October 2026

Reusable boundary: the standalone guide, workflow guidance, themed presentation, browser navigation,
and edition policy slots belong to core. Edition-specific policies are supplied by consumers through
`AgentGuideEdition`; they are not embedded in the shared copy.

Base: `618a8a9912052f7dca40d0cdef0a2b8ffb1dfb67`, branch `codex/agent-guide`.
Preview: `npm --prefix frontend run dev -- --host 127.0.0.1 --port 5211 --strictPort`,
then open `/for-agents`. No model execution is needed to read the guide.

## Scope

- Ordinary footer link, direct `/for-agents` route and stable topic fragments.
- Six native disclosure sections, script section open first, expand/collapse all, short script example. No overview, topic index, edition badge or section subtitles.
- English and Simplified Chinese; theme and language use existing preferences.
- Separate `meowdiobooks-workflow-ui/agent-guide` public entry for composition.
- Guide code and CSS load only on this route.
- Page-wide dithered SVG background: CSS transforms animate the cat, pages and backdrop automatically.
  A header control pauses motion; hidden tabs pause it too. Reduced-motion CSS disables animation.
  No WebGL, canvas, requestAnimationFrame or added dependency.
- Small Bayer-4 path helper adapted from [dithercn](https://github.com/opencoredev/dithercn/tree/235d1345b0efa90e4525befcdc082c9711af3a15),
  with the MIT notice in `frontend/src/components/agent-guide/DITHERCN-LICENSE.txt`.

## Checks

- `npm --prefix frontend run build`: passed. Existing large-chunk advisory remains.
- `npm --prefix frontend run lint`: no errors; pre-existing LanguagePicker fast-refresh warning.
- `npm --prefix frontend test`: 576 tests passed, including 5 guide tests for disclosures, edition
  policy, locale, pause and hidden-tab suspension.
- `npm --prefix frontend test -- src/pages/AgentGuide.test.tsx src/App.test.tsx src/app/useAppearance.test.tsx`:
  229 tests passed after the shared App/footer appearance integration.
- Chrome browser reuse: studio upload and navigation controls exposed by name; followed the actual
  studio footer to the guide; expanded all six topics, collapsed an individual topic with Enter,
  switched language and theme. In the revision, verified automatic movement from changing computed
  transforms, and a stable transform across separate observations while paused.
- Responsive Chrome layouts at 390 and 320 CSS pixels: no horizontal overflow, including Chinese.
  Temporary viewport overrides restored after verification.
- Browser checks cover discovery and guide interactions; no paid generation or full audio workflow
  was launched. Reduced motion was implemented and reviewed in CSS, not emulated in this browser.

`bundle-sizes.json` compares a production build of the base commit using the same installed toolchain
with the local candidate in `bundle-sizes.json`. Main JS/CSS remains separate from the route-specific
art and copy. Guide-only JS/CSS is emitted as a separate lazy-loaded chunk.
Hashes may change on rebuild; these are bundle measurements, not a device-wide frame-rate benchmark.


Screenshots show only the guide and synthetic examples. Version 0.1.75 adds the standalone guide
entry for consumers. Costs explain that saved-result browsing and existing audio playback incur no
API usage, while AI Review and configured remote jobs use the account when processing runs.
