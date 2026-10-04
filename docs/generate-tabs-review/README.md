# Generate tabs review · workflow 0.1.50

The accepted Generate view has two tabs: **To make** (default when work remains) and
**Generated** (current audio only). Older recordings remain listenable in To make;
empty chapters remain visible but disabled. Fully generated books open Generated.
Changing tabs clears selection. Selected current audio goes to Export by default;
Regenerate is a named secondary action. Normal generation excludes already-current
recordings, including a defensively mixed selection. Selected purchased rows retain
the subtle existing gold wash, with selection marked by checkbox and a narrow edge.

These screenshots render the production workflow through the deterministic synthetic
Alice public-domain gateway. They are local UI evidence, not provider execution or
staging deployment. Before screenshots are available in the prior 0.1.48 review record
and the source changes make the exact behavioral transition inspectable.

| View | Mobile 390 × 844 | Desktop 1440 × 1000 |
| --- | --- | --- |
| To make | [Screenshot](to-make-mobile.png) | [Screenshot](to-make-desktop.png) |
| Generated selection | [Screenshot](generated-mobile.png) | [Screenshot](generated-desktop.png) |

## Reproduction and verification

```sh
npm --prefix frontend run storybook -- --port 6027
GENERATION_REVIEW_URL=http://127.0.0.1:6027 node frontend/scripts/verify-chapter-selection-polish.mjs /tmp/chapter-selection
GENERATION_REVIEW_URL=http://127.0.0.1:6027 node frontend/scripts/verify-generation-layout.mjs /tmp/generation-layout
GENERATION_REVIEW_URL=http://127.0.0.1:6027 node frontend/scripts/verify-generation-modal-return.mjs /tmp/generation-modal
```

- 373 frontend tests passed; ESLint (one pre-existing refresh warning), production build and Storybook types passed.
- 513 backend baseline tests passed, 3 native decoder/model tests excluded. Backend processing is unchanged.
- 64 Storybook browser/accessibility tests passed after updating the player story to select Generated.
- Packaged consumer verification passed, including shared modal isolation and cross-entry focus/lock handoff.
- Chromium and WebKit selection/export checks passed across mobile/desktop and light/dark: 8 combinations.
- Generate layout: 36 combinations passed across Chromium/WebKit, 1440/390/320 widths and light/dark.
- Modal resize/return and Chinese labels at 200% font size: 6 combinations passed.
- Canonical visual review: 96 responsive appearance/scenario combinations passed.
- Independent source review found no blocking issue; reviewer independently ran the 22 GeneratePage tests.
- The public-domain synthetic fixture exercises old/current/absent/empty audio without running model or provider work.
