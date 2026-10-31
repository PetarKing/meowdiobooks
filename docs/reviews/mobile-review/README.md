# Mobile review navigation and chapter evidence

On phones (up to 700px), Review shows the remaining decisions beneath the choices. Once the
current choice is made, a **Continue review: [category]** button opens the next unresolved decision
and brings its evidence below the header. The action stays in normal document flow: no floating
panel obscures the passage, and an unanswered item never offers a button pointing back to itself.
Category completion remains distinct from whole-review completion.

Desktop keeps its existing category navigation and transcript action; the new next-category action
and automatic evidence scrolling are mobile-only. Both layouts gain fuller chapter context, original
page inspection, and clearer suggested-choice completion wording. Existing manual decisions, bulk
choice semantics, transcript preview, and final acceptance remain unchanged.

Chapter evidence shows every supplied context paragraph, including split title lines and the
opening passage, with compact paragraph spacing rather than raw PDF display gaps, while keeping the exact original boundary anchor highlighted. PDF readers can
inspect the original page and neighboring pages in a modal; media failure offers retry and leaves
review decisions intact. Text imports do not offer a PDF control.

All screenshots use synthetic text and the production App with a fixture gateway. No customer
manuscript, screenshot, account identifier, or service data is included.

| State | Before (`fde4f82`) | Revised draft |
| --- | --- | --- |
| Mobile: split chapter title | ![Before mobile chapter](chapter-before.png) | ![After mobile chapter](chapter-after.png) |
| Mobile: suggested choices finished | ![Before mobile completion](category-before.png) | ![After mobile completion](category-after.png) |
| Desktop: split chapter title | ![Before desktop chapter](chapter-desktop-before.png) | ![After desktop chapter](chapter-desktop-after.png) |
| Desktop: suggested choices finished | ![Before desktop completion](category-desktop-before.png) | ![After desktop completion](category-desktop-after.png) |

The [first draft mobile capture](chapter-first-draft.png) records the rejected floating panel and
excessive source spacing. The revised screenshots above replace that design.

## Reproducible verification

Environment: macOS arm64, Node 22.23.4, locked npm dependencies, Playwright Chromium. Native tests;
no Docker, model inference, or live service changes.

```sh
npm --prefix frontend ci
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
npm --prefix frontend run test-storybook -- stories/MobileReviewNavigation.stories.tsx stories/CompactReviewPassages.stories.tsx stories/CleanupReview.stories.tsx stories/AliceReviewPassages.stories.tsx stories/ScriptDirections.stories.tsx stories/ReviewSourcePage.stories.tsx
npm --prefix frontend run storybook -- --port 6017
node frontend/scripts/verify-mobile-review.mjs http://127.0.0.1:6017
```

For before/after captures, export baseline `frontend/` into a separate temporary directory, install
its own locked dependencies, and copy only `MobileReviewNavigation.stories.tsx` from the candidate.
Run its Storybook on 6018 and pass `http://127.0.0.1:6018` as the second script argument and an output
directory as the third. Separate node_modules directories avoid sharing Vite optimization caches.

Results:

- Frontend suite: 44 files, 586 tests passed.
- Focused real-browser stories: 6 files, 22 tests passed, including existing public-domain Alice
  URL, credits, and verse passages; synthetic split-title, legacy context, script directions,
  source-check-after-bulk, manual-choice preservation, and isolated original-page/error cases.
- Browser matrix: 320, 390, 768, and 1440px, light and dark. Each completes suggestions, uses the mobile
  next-category action or existing desktop queue, resolves the remaining decisions, opens the transcript, returns, and verifies
  the manually kept choice. Each opens a PDF page, browses to the next page, closes with Escape,
  and verifies focus restoration. No horizontal overflow or axe violations in any final review state.
  [Machine-readable results](browser-report.json).
- Unit tests cover original-page error/retry, bounds, host media callback, lazy loading, exact source
  anchors, Chinese/legacy snippets, mobile-only navigation focus, and authoritative preview payload preservation.
- Build and story typecheck pass. ESLint has no errors; two existing Fast Refresh warnings remain in
  LanguagePicker.tsx and main.tsx. Vite retains its existing large-chunk advisory.
- Two independent source reviews examined navigation/acceptance and source/media boundaries. Neither
  found a correctness defect. The subsequent design revision was inspected at mobile and desktop sizes; its full suite and browser matrix were rerun. An initially incomplete matchMedia test mock was corrected before the passing rerun.

The backend extraction/attribution/audio evaluation matrix was not rerun: no processing, models,
artifact contracts, or accepted book data changed. The relevant public-domain Alice presentation
stories ran; synthetic multiline and Chinese source tests extend that presentation coverage. These
fixtures prove UI behavior, not new inference accuracy or live-host media authorization. A shared
release and downstream pin update are required before Alpha can adopt this change. No deployment
is included in this draft.
