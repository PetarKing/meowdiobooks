# Workflow copy review — 4 October 2026

The shared workflow repeated status, instructions and chapter totals across page headings,
section headings, cards and action bars. The completed one-chapter Generate view was the clearest
example: “1 of 1”, “None remaining” and “0 chapters” all described the same state.

## Changes

- Home and Library: remove redundant shelf/page eyebrows.
- Extract and accepted steps: retain the result title, useful facts, change action, replacement
  safety note and applicable cost receipt. Remove repeated Complete/Accepted/Ready labels.
- Dialogue: remove the duplicated choice introduction and fallback explanation. When there are no
  unresolved targets, show the no-AI outcome and transcript action without empty scope controls.
- Review: use one progress count and keep consequences inside their decision buttons. Retain source
  evidence, group-wide scope, unchanged-text protection and recovery instructions.
- Cast: remove self-evident narration-language help, redundant dialog eyebrows and zero-count voice
  approval summaries. Required confirmations, optional approval and replacement warnings remain.
- Generate: remove the three hero counters and shown count; retain chapter status and listening
  length. Generation/regeneration estimates accompany selected actions, including the compact dock.
  A single chapter does not need filters or bulk controls. Saved filters cannot hide its row or
  change its action: a selected current recording exports primarily and can regenerate separately.
- Export: retain one selected-count/duration summary, format tradeoffs, estimated sizes and metadata;
  remove duplicated section eyebrows, format prose and preview totals.
- Help and recovery: remove repeated framing while retaining operational guidance.

The same removals apply in English and Chinese. “Regeneration” is translated, and the Chinese
narration-language label now describes the whole audiobook. No processing, payment, persistence,
provider or source-text contract changes are included. The UI/Python release versions are 0.1.44.

## Verification

Baseline: `cdefb3c6e9eb7f63253523827985f6eb3ef9d32e` (workflow-v0.1.43).
Independent Astra and Sol 6.1 High audits covered every step before implementation; follow-up
source reviews checked scope, errors, replacement policy and hidden-filter behavior.

- `npm test -- --run`: 351 tests passed, including saved all/pending/generated filters for a single
  current chapter, secondary regeneration and the zero-target Dialogue case.
- `npm run lint`, `npm run build`, `npm run storybook:check`: passed. Existing LanguagePicker
  fast-refresh lint warning and bundle-size advisory remain.
- `npm run test-storybook`: 62 browser/accessibility scenarios passed.
- `npm run build-storybook && npm run visual:review -- <output>`: 96/96 checks passed before and after
  (24 canonical scenarios, 1440×1000 and 390×844, light/dark). No overflow or axe violations.
- `npm run test:consumer`: packaged development/production host compatibility passed.
- Backend release baseline: 513 passed, 3 model/decoder tests deselected; no backend behavior changed.

The `product-visual-review` CI artifact includes the JSON results and named PNGs for this candidate.
Local before/after evidence is retained in `/private/tmp/meow-copy-before` and
`/private/tmp/meow-copy-after`; key comparisons are `generate-1440-light.png`,
`generate-390-light.png`, `review-1440-light.png`, and `export-390-light.png`.
Browser inspection also covered Chinese Generate, Export and Review. Alice-based canonical fixtures
and synthetic source previews were used. No new inference, paid generation or audiobook export was
needed for these presentation changes. Publication, host adoption and deployment are separate gates.
