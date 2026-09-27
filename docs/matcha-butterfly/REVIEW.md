# Executed review and limits

Base source checkpoint: `f29f5dd2f5e16dcf8430be8cdd94425f70b37b33`, branch `codex/studio-rebuild`. This review covers the subsequent butterfly source changes. `source-manifest.json` records exact source hashes rather than attributing uncommitted changes to the base checkpoint.

## Executed validation

- Full unit suite: 25 files, 247 tests passed. New regressions exercise native chapter selection, independent Listen, unavailable chapters and the icon toggle.
- Production TypeScript/Vite build and Storybook typecheck passed. Vite retains the existing large-bundle warning (567 KB JavaScript); this iteration does not claim a loading-performance improvement.
- Lint: zero errors; the pre-existing LanguagePicker fast-refresh warning remains.
- Real Chromium Storybook suite: 5 files, 57 tests passed.
- Packed external consumer: fixed host translation/hook contract compiled; standalone primitives and App respect ordinary equal-specificity host CSS loaded afterward. Public appearance/palette and 31-key edition contracts remain intact.
- Independent live matrix: 6 states × 3 widths (1440/900/390) × 2 modes, all 36 cases with zero horizontal overflow and zero axe violations. Accepted Dialogue's annotation bounds and one focus indicator were checked directly, beyond page overflow checks. Dialogue was recaptured after removing its inner frames.
- Home: 1440/390/320 in both modes, decoded artwork, zero overflow, PDF selection/change receipt, persisted appearance, zero runtime errors and zero real API requests.
- System appearance: initial OS preference, live OS changes while System, explicit preference and reload checked across eight transitions. Independent Space-key toggle also passed.
- Generate: desktop/phone in both modes, native whole-title and blank-space clicks, Space, independent Listen, disabled unavailable rows and Select all exclusion. Final script uses production CSS without injected styling.
- Export: desktop/phone in both modes, 20 chapters, long mixed-script metadata, all three formats, upload/reset/PDF page, native chapter selection and empty-selection/title gates. No overflow, runtime errors or axe violations in those checks.
- Synthetic 200% text enlargement: home, Review, cast inspector and 120-chapter Generate in both modes. No horizontal page overflow or runtime errors. Clipping candidates were the deliberately clipped logo/accessibility-only label and compact rail book title; no actionable content collision was observed. This is font-size enlargement, not native browser zoom or a WCAG conformance claim.
- Solid semantic-control contrast measurements passed at 4.5:1 or better in both modes. This is a bounded token check, not a claim that every possible background/image combination is audited.

## Reproduce

Start the safe studio and Storybook before browser checks:

```sh
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
npm --prefix frontend run test-storybook
npm --prefix frontend run test:consumer
node frontend/scripts/verify-appearance.mjs
node frontend/scripts/review-preview.mjs http://127.0.0.1:5179/studio.html docs/matcha-butterfly/evidence/home
node frontend/scripts/verify-system-appearance.mjs http://127.0.0.1:5179/studio.html docs/matcha-butterfly/evidence/appearance
node frontend/scripts/review-text-enlargement.mjs http://127.0.0.1:5179/studio.html docs/matcha-butterfly/evidence/text-enlargement
node docs/matcha-butterfly/evidence/generate/verify.cjs
node docs/matcha-butterfly/evidence/export/verify.mjs
node docs/matcha-butterfly/evidence/independent/audit.mjs
node docs/matcha-butterfly/evidence/independent/export-focus.mjs
```

The checkpoint includes source, reproducible scripts, compact receipts and representative captures. The complete generated matrix remains in the workspace, preserved without committing every long screenshot.

## Scope

These checks use synthetic fixtures and silent recordings. They verify rendered interaction and existing gateway-request tests; they do not prove real extraction, inference, audio encoding or filesystem delivery. No production adoption or external publication occurred. Aesthetic acceptance remains the user's judgment, and this review does not label its own result S-tier.
