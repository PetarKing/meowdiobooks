# Folio workflow composition verification

The page rebuild preserves the existing hook-free page mount contract, model commands, acceptance gates, accepted revisions, stale audio and export selection semantics. It changes the composition of evidence and choices.

- Extract: compact source task, concise parser choices, sampled source/text comparison.
- Dialogue: everyday AI/Narrator choice first; matching rules and custom detection tools afterward. Source examples are expandable details. Disabled choices keep their explanation legible.
- Review: semantic decision queue beside the source and resolution desk. At common desktop widths, the source and consequence choices are co-visible. Queue buttons have natural height. Phone uses a bounded two-column queue followed by evidence and decisions.
- Generate: chapter tracklist with explicit readiness, source page range, listening duration, generation estimate and independent listening action. A 120-chapter synthetic fixture contains 40 current tracks and 80 pending tracks. Failed generation repeats the error beside its action without creating a duplicate alert announcement.
- Export: chapter manifest and metadata editor left; live jacket/title/author/selected-duration/format preview and output choices right. Phone starts with identity preview and details, followed by the chapter manifest and output choice.
- Library: compact jackets beside complete edition titles, selected chapter scope and readable metadata; actions sit below the bibliographic receipt. Missing covers retain readable monograms without occupying a large poster.

## Executed evidence

Local preview: `http://127.0.0.1:5179/studio.html`. Storybook uses the same production pages and synthetic workflow gateway. New story: `Product/Studio/Generate Long Book` (`generate-long-book`). Existing stories cover extraction/accepted, dialogue setup/conflicts/results, review boundaries/final/recovery, generation stale/failure/player, export long book and library empty/missing cover.

A Playwright matrix exercised 17 meaningful states at 390×844, 900×1100 and 1440×1000 in light appearance. All 51 viewport/document/main width checks reported no horizontal overflow after the phone long-book fix. Screens were saved under `/private/tmp/folio-<scenario>-<size>-light.png`. Selected desktop screenshots, dark tablet comparisons, phone queue, failure receipt and library fallback were visually inspected. The independent design critic additionally inspected dark/mobile and challenged queue sizing, buried decisions, fallback-cover dominance and offscreen generation errors; these findings were fixed and rechecked.

The generation failure phone fixture was executed through its real synthetic command. After the failure, the local error receipt occupied viewport y=413–498 at scrollY=1018 in an 844px-high viewport; its selected tracks and retry action remained visible. Document width was 390px. The global alert still announces the same error.

Commands:

```sh
npm --prefix frontend test -- --run src/App.test.tsx
npm --prefix frontend test -- --run design-kit/fixtures.test.ts
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
```

Before the added error regression, all 109 existing App behavior tests and both fixture contract tests passed. Presentation expectations were updated only for renamed headings, removal of decorative chapter-cover markup and replacement of horizontal Review arrows with a semantic queue. Command/gateway assertions and acceptance behavior checks remain. The Export test also verifies the live preview reflects an edited title and author. A new negative regression checks that pending generation failure keeps the error beside its enabled action and saved audio remains listenable. Final integrated results are recorded by the coordinating agent.

These checks use deterministic synthetic sources. No backend extraction/inference was rerun, no accepted user artifact was changed and no release or deployment was performed.
