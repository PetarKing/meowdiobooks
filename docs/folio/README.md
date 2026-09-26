# Folio — current design review candidate

The user rejected Nocturne's color scheme, oversized entrance and insufficient improvement over production. Folio replaces that direction with warm paper/graphite/vermilion and a complete charcoal/ivory/peach counterpart. It changes working compositions as well as appearance. This candidate lives on `codex/studio-rebuild`; rejected commit `688d07e` remains preserved on `codex/nocturne-studio`.

## Open and edit

The running [manual preview](http://127.0.0.1:5179/studio.html) uses synthetic data. Its state selector exposes empty, running, failure, recovery, dense cast, inspector and long-book states. The header's **Light / Dark / System** choice works throughout the app and persists locally. [Storybook](http://127.0.0.1:6018/) renders the same production source with component controls and 40 workflow stories.

To restart from the repository root:

```sh
npm --prefix frontend run storybook -- --port 6018
VITE_STORYBOOK_URL=http://127.0.0.1:6018 npm --prefix frontend run studio
```

Edit production pages in `frontend/src/pages`, shared controls in `frontend/src/components`, and their owning sheets as described in [stylesheet ownership](../../frontend/src/styles/README.md). [The design system](../../frontend/DESIGN_SYSTEM.md) records typography, color, composition and consumer contracts. These are live source-based previews; screenshots are supplementary evidence.

## Concrete changes

- Home integrates import with its introduction and exposes resume work in the first desktop viewport. A code-native animated book converts paper into audio waves; static and reduced-motion fallbacks remain available, with a small phone emblem.
- Review places the decision queue, manuscript evidence and consequence choices together. Phone keeps a bounded queue and accessible resolutions.
- Cast puts required voices first, offers a direct route to each blocker, and presents auditions before tuning. Search changes visibility without weakening acceptance requirements.
- Generate uses aligned chapter tracks with readiness, source range and listening/generation estimates. Failure feedback appears beside the action and preserves saved audio. A 120-chapter fixture exercises scale.
- Export brings the manifest, metadata and live edition preview together. Library uses compact bibliographic rows with distinct edition scope.
- Header navigation replaces the overlapping phone footer. Language and appearance remain available; inspectors preserve their focus and draft lifecycle.

## Review and evidence

[Independent critique](REVIEW.md) compares actual retained production and rejected screenshots, lists observed defects and rechecks their repairs. [Appearance](APPEARANCE.md) documents preference/host/portal behavior and contrast probes. [Workflow verification](WORKFLOWS.md) documents page-specific execution.

Final unit/browser/consumer results are in [verification.json](evidence/verification.json). Final focused [light](evidence/final-light.json) and [dark](evidence/final-dark.json) captures have no reported runtime, accessibility or overflow failures. The full [dark matrix](evidence/dark-matrix.json) covers 52 product/component/composition stories at desktop and phone sizes. [Motion and preview safety](evidence/preview-motion.json) records offscreen pause/resume, GPU release, no-WebGL fallback, hidden phone allocation, pending-import races and navigation/reload without API calls.

| Surface | Light | Dark |
| --- | --- | --- |
| Home | [Desktop](screenshots/home-1440-light.png), [phone](screenshots/home-390-light.png), [animated render](screenshots/home-motion-light.png) | [Desktop](screenshots/home-1440-dark.png), [phone](screenshots/home-390-dark.png) |
| Review | [Desktop](screenshots/review-1440-light.png), [phone](screenshots/review-390-light.png) | [Desktop](screenshots/review-1440-dark.png), [phone](screenshots/review-390-dark.png) |
| Cast voices | [Desktop](screenshots/cast-voices-1440-light.png) | [Desktop](screenshots/cast-voices-1440-dark.png) |
| Audition inspector | [Desktop](screenshots/cast-inspector-1440-light.png) | [Desktop](screenshots/cast-inspector-1440-dark.png) |
| Export | [Desktop](screenshots/export-1440-light.png), [phone](screenshots/export-390-light.png) | Covered in full dark matrix |
| Library | [Desktop](screenshots/library-1440-light.png), [phone](screenshots/library-390-light.png) | Covered in full dark matrix |
| 120 chapter generation | [Desktop](screenshots/generate-long-book-1440-light.png), [phone](screenshots/generate-long-book-390-light.png) | Covered in full dark matrix |

Inspector full-page captures include background content beyond the viewport below the fixed dialog; their viewport portion represents the actual visible inspector.

## State and limits

Implemented and locally verified; ready for user design review. Aesthetic acceptance remains pending, so the goal stays active. Tests do not establish an S-tier grade. Synthetic gateways and silent audition audio do not prove real narration quality, backend acceptance or filesystem export. No merge, push, release or deployment was performed. The existing shared JS/CSS remains substantial; Three.js is lazy and omitted from hidden phone art.
