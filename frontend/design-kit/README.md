# Production UI review fixtures

Storybook imports the actual `src/App.tsx`, shared controls and product stylesheet.
`createFixtureGateway` supplies deterministic synthetic book, chapter, voice and
export data; mutations stay inside each gateway instance. Audio is a generated
silent WAV. No model, provider, filesystem export or live backend is exercised.
Fixtures are development-only and excluded from the published package.

Run `npm run storybook` for the catalogue, `npm run storybook:check` for its types,
`npm run test-storybook` for real-browser interaction and accessibility checks,
and `npm run build-storybook` to verify the distributable review surface.

## Accepted-source comparison

`npm run visual:parity -- <accepted-git-ref> <output-directory>` archives only the
accepted production source into a temporary ignored directory, then renders that
source and the candidate with **identical current stories, data and dependencies**.
It tests every Product story at 1440 × 1000 and 390 × 844. Legacy HTTP media
fallbacks receive the same fixture image/audio on both sides. Each screenshot must
stabilize before comparison. Dimensions must match and pixelmatch must find zero
significant changed pixels at threshold 0.05; the report also retains byte equality,
raw differing pixel counts and maximum channel deltas. This small color threshold
handles antialiased edges, not missing controls or layout differences.

The report includes unfiltered axe findings for both source versions. Browser
story tests retain only selector-specific, **color-contrast-only** exceptions
measured in accepted commit `d3855c3bb921d654aae02bb28fa3858a7e01b86c`, recorded in
`stories/baselineContrastExceptions.ts`. Other rules remain active on those nodes.
These exceptions are inherited debt, not accessibility approval. Remove selectors
when their source contrast is repaired; do not add exceptions for a new design.

CI compares the PR base SHA with the candidate and uploads compact PNG/report
artifacts. Deliberate visual changes require an explicit change to this parity
contract and visual review; do not silently update a reference to make a redesign
pass. Passing tests is neither aesthetic approval nor proof of live workflow success.
