# Finish pass — September 29, 2026

The selected Matcha & Cherry sanctuary remains the art direction. This pass strengthens its working screens, shared components and recovery states. It is a local, unmerged candidate; visual acceptance remains open.

## What changed

- **Shared Cast/Voices:** one curved-card component, colored monogram field, status spine and stable phone name placement. Cast uses the same open toolbar treatment as Voices. Audition selection uses a quiet check and underline; Design/Clone are source tabs. Playback swaps initials for seven bars with varied cadence, fades the play cue, and returns on stop/end.
- **Home/Library:** compact source-book shelf with a separate delete icon; genuine cover art fills its surface. Finished editions retain readable names and host-owned actions. Initial Library errors offer Retry rather than claiming an empty collection; a failed refresh keeps the last successful editions.
- **Working stages:** the canopy fades before controls without trapping fixed dialogs. Dialogue conflicts have one evidence sheet with open interpretations; phone summaries are compact. Review pagination/help targets are 44 px. Generate's summary sits beneath its heading.
- **Export:** full natural-height page at the preview column's edges, controls over the lower fade, inline editorial title/author/description and a compact sticky dock while browsing selections. Reset, empty title, chapter selection and the end-of-document action were exercised.
- **Truthful audition flow:** first generation starts directly. Replacing an existing set still confirms its consequence. The synthetic gateway now mirrors backend replacement, uses unique audition revisions, and leaves the accepted snapshot intact.

## Rendered evidence

| Surface | Desktop | Phone and behavior |
| --- | --- | --- |
| Cast/Voices | [Shared roster](cast/voices-desktop-light.jpg), [Cast](cast/cast-desktop-dark.jpg) | [Phone](cast/voices-phone-dark.jpg), [playing](cast/voices-playing-phone-dark.jpg), [auditions](cast/auditions-phone-dark.jpg), [lane report](cast/README.md) |
| Home/Library | [Home shelf](home-library/home-six-1440-dark.jpg), [finished editions](home-library/library-1440-light.jpg) | [Library](home-library/library-390-dark.jpg), [32-state report](home-library/README.md) |
| Export/Review | [Export light](composition/export-1440-light.jpg), [dark](composition/export-1440-dark.jpg), [Review desk](composition/review-1440-dark.jpg) | [Compact dock](audit/final-export-20chapters-320-light.jpg), [document end](audit/final-export-end-320-light.jpg) |
| Independent audit | [Full findings and final checks](audit/README.md) | Modal layering/focus, dense 320 px rosters, Library failures, first/replacement auditions, settings returns, Export controls |

Screenshots are CUA JPEG captures. The browser's 90% zoom requires a physical clip of 1296 × 810 for a measured 1440 × 900 CSS viewport; some early audit captures retain the extra pale raster margin. Root composition captures use the corrected physical clip. They are ordinary viewport views, so the naturally tall PDF page continues below the screen edge without being cut by its component.

## Executed validation

- 262 frontend tests in 25 files: passed. New regressions cover first-audition creation, Library error/retry and retained editions, and fixture replacement/accepted-snapshot isolation.
- Lint: zero errors; the existing LanguagePicker Fast Refresh warning remains.
- Production build, Storybook type check and static build: passed. The existing large-chunk warning remains.
- Packed public package: 87 files; fixed host translation/hook contract compiles. A disposable external host was served, then CUA verified that ordinary later host CSS supplied `rgb(1,23,45)` and `3px` radius to both standalone and App controls. The original headless browser scripts were not used for this check.
- CUA inspected desktop 1440 px and phones at 390/320 px, both appearances. Home/Library covered 32 combinations. The independent audit exercised representative workflow states, negative/recovery paths, keyboard modal lifecycle and the Export dock. No horizontal overflow in the final checked states and no new console errors/warnings after a cold reload.

Reduced-motion behavior was inspected in source; CUA exposes no media-preference emulation. Fixture audio verifies playback lifecycle, not voice synthesis quality. No real provider synthesis, sample upload, backend extraction, production export, merge, release or deployment was performed in this pass. Prior backend/media evidence remains in the September 28 record, separately identified.
