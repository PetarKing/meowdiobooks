# Neutral design-system adoption — 20 September 2026

The foundation extracts production page views and reusable controls from accepted main
`d3855c3bb921d654aae02bb28fa3858a7e01b86c`. It preserves the accepted presentation and
workflow commands. The rejected Ink & Persimmon direction and its dirty worktree were
not merged or copied wholesale.

## Ownership and compatibility

- `app/useWorkflowModel` retains existing state and commands. Typed page models select
  only their required fields; the shell retains existing mount boundaries.
- `PresentationRoot` owns optional semantic colours. Main remains the default, roots
  cannot nest, and no theme name controls product behaviour. Whole art directions use
  separate preview frames. Geometry remains in the page/component that owns it.
- `Button`, `TabList`, dialog focus lifecycle, source excerpts and page comparisons are
  reusable production source. Storybook renders the same components and actual App.
- `product.css` is an explicit, unlayered public entry. Hosts load it before ordinary
  overrides; App does not impose a global stylesheet import. Legacy style exports remain.
- Three optional media resolvers preserve exact HTTP fallbacks. Existing host translation
  bundles still have 31 required keys. Header, journey/step and Library hooks remain valid.

No backend, polling, audition policy, source reason fields, required footer copy, rejected
fonts/art/logo, or historical design archive is part of this adoption. There are no new
runtime dependencies or hosted services. Storybook, browser testing and image comparison
are development dependencies only.

## Verification method

`npm run visual:parity -- d3855c3bb921d654aae02bb28fa3858a7e01b86c <output>` renders an
immutable archive of accepted production source and the candidate with identical current
synthetic fixtures, stories and dependencies. All 32 Product scenarios run at desktop
1440 × 1000 and phone 390 × 844. Image dimensions must match, with zero significant pixel
differences using pixelmatch threshold 0.05; raw differences are retained to distinguish
antialiasing noise from byte-exact matches. CI repeats this comparison against the PR base
and uploads the screenshots and machine-readable report.

`npm run test:consumer` packs the actual public source package, compiles a separate host
with fixed accepted-main translation keys and hooks, and opens both primitive-only and
App consumers in Chromium. It checks the default primary style and equal-specificity
host overrides loaded after the public stylesheet. Package inspection rejects development
fixtures and rejected assets.

Independent reviewers compared the extracted page bodies and command statements against
accepted source, inspected public boundaries and package contents, and exercised dialog
focus in Chromium. A simultaneous nested-dialog focus defect was found and repaired;
focus wrapping, hidden-control skipping, Escape/opener and scroll restoration were checked.

## Explicit limits

Browser fixtures are synthetic. Audio is silent, gateway mutations stay in memory, and
no real model generation, book export, paid provider or backend acceptance was exercised.
Backend processing commands are unchanged; this is not runtime evaluation or deployment.

Accepted main contains contrast debt. Browser tests exempt only measured selectors from
only the contrast rule, recorded in `frontend/stories/baselineContrastExceptions.ts`.
Other accessibility rules remain active. Nonvisual landmark, label and heading semantics
were repaired without redesigning the accepted pages. The parity report retains unfiltered
axe findings for both sources. These exceptions are not accessibility approval and must
be removed when the affected colours change.

The existing large production-chunk warning and LanguagePicker Fast Refresh lint warning
remain. Passing this review authorizes only the already requested foundation merge. A new
cosy redesign must branch from the merged result and remains subject to visual approval;
no workflow release, Cloud adoption or deployment is included.

## Recorded candidate results

- Unit suite: **226 tests across 21 files passed**.
- Storybook Chromium interaction/accessibility suite: **34/34 passed**, with only the
  documented inherited contrast exceptions.
- TypeScript/product build, Storybook types/build and lint passed. The two existing
  warnings noted above remain.
- Desktop/phone parity: **64/64 passed**, 60 byte-identical; the remaining four have
  zero significant changed pixels. [Machine-readable summary](evidence/visual-parity.json).
- External packed consumer: 61 files, fixed host bundle/hooks compile; Chromium checks
  baseline primary colour and equal-specificity overrides for both consumer forms.
- Actual-browser palette checks verify shared Button and real App propagation, sibling
  isolation, unchanged control geometry and commands, and a single App root.

Representative candidate renders (synthetic fixture data):
[Home desktop](evidence/home-1440-candidate.png),
[audition inspector phone](evidence/cast-inspector-390-candidate.png),
[20-chapter Export phone](evidence/export-long-book-390-candidate.png).
The complete before/after set is reproducible and uploaded by CI.
