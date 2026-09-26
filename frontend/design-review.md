# Product design review

This is the review ledger for the fresh studio direction. A passing automation check proves a specific behavior, not an aesthetic grade. Integrated desktop and phone renders have been independently inspected; this ledger distinguishes those observations from automated checks and production acceptance.

## Reproducible review surface

- Start `npm --prefix frontend run storybook`; the preview is isolated from the application API proxy.
- Production page stories run the real App, page renderers and commands with synthetic in-memory gateways.
- `npm --prefix frontend run storybook:check` checks stories and fixture types.
- `npm --prefix frontend run test-storybook` exercises scenario entry and component keyboard interactions in Chromium.
- `node frontend/scripts/review-design.mjs http://127.0.0.1:6006 /tmp/meowdiobooks-design-review` captures every product/component story at 1440 × 1000 and 390 × 844, checks accessibility without inherited contrast exclusions, records horizontal overflow, image failures and browser errors.
- The optional fourth argument is a regular-expression story filter for focused rechecks.
- `npm --prefix frontend run test:consumer` verifies the packed public package, host TypeScript composition, canonical styling, and ordinary equal-specificity host overrides in resting and hover states.
- `visual:parity` remains the foundation extraction check against the exact accepted baseline. A deliberate redesign should change its pixels; do not misreport parity failure as a workflow regression or alter the baseline to hide the difference.

## Independent review inventory

The component agent reviewed primitive semantics and browser interactions; a separate reviewer inspected integrated page and modal renders. Named stories are reproducible entry points. Domain interactions retain the existing unit/browser coverage rather than claiming a complete real-provider workflow evaluation.

| Surface | Review focus | Story coverage |
| --- | --- | --- |
| Button | Action hierarchy, disabled state, touch target, focus | Components / Actions |
| Panel | Heading rhythm, surface grouping, flexible actions | Every component story and product pages |
| Tag | Meaning without color, compact readability | Components / Surfaces and status |
| Choice | Selected state, tooltip independence, keyboard dismissal | Components / Choices; Extract and Dialogue |
| TabList | One tab stop, arrows, Home/End, panel relationship | Components / Keyboard tabs; Cast |
| SourceExcerpt | Verbatim evidence, highlight readability | Components / Surfaces and status; Review and Cast inspectors |
| DialogSurface | Focus trap, Escape, return focus, scroll lock | Components / Dialog |
| InspectorDialog | Responsive modal, closing lifecycle, dense audition form | Cast inspector, missing audition, pending sample |
| PresentationRoot | Palette isolation, single App root, host override | Foundations / Presentation contract |
| NarrationLanguagePicker | Native disclosure, selection, Escape and focus | Components / Language; Generate |
| LanguageToggle | App locale distinct from narration language | All product pages; existing locale unit coverage |
| CastingChoice | Model choice, exact costs, reuse, unavailable quotes | Cast identities and existing casting component tests |
| CollectionToolbar | Name/source-label search, status filtering, Clear focus, global gates | Components / Collections; both dense Cast pages |
| StepIntro / WorkflowEmpty / WorkflowLaunch | Reusable composition, editable controls, empty/preparation states | Components / Workflow compositions |
| StudioHero / SoundField | Decorative art, progressive WebGL, motion preferences, cleanup | Home/import; standalone preview checks |
| CastIdentityReview | Classification, evidence, long/dense ensembles | Cast identities, dense, inspector |
| CastVoiceReview | Audition selection, confirmation, unavailable audio | Cast voices, dense, inspector, missing, sample pending |
| DialogueRoutingChoice | Automatic/provider options, unresolved route | Dialogue setup; routing unit coverage |
| DialogueResultReview | Attribution evidence, corrections, recovery | Dialogue results and conflicts |
| ChapterAudioPlayer | Listen controls, chapter context, modal phone size | Generate player |
| PhaseHelp | Useful guidance, dismissible focus-safe overlay | Phase help |
| Home / Import | One clear starting action, resume books, local file state | Home, Import, Home error, Delete dialog |
| Library / skeleton | Readable editions, empty/loading/error/fallback | Library, empty, loading, error, missing cover, refresh error |
| Extract | Source comparison, chosen method, preview versus acceptance | Extract, Extract accepted |
| Dialogue / recovery | Setup clarity, overlaps, results, progress | Dialogue, conflicts, results, accepted, running |
| Review | Consequences, source traceability, bounded decisions | Review warnings, boundaries, final, accepted, recovery |
| Cast | Identity then voice work, safe confirmations | Identity, voice, dense, inspectors, accepted, pending |
| Generate | Chapter selection, retained audio, stale/error/progress | Generate, stale, split, player, running, failed |
| Export | Current selection, format, cover, completed edition | Export, long book |
| App shell | Orientation, stage status, mobile navigation, command locality | Every product story |

## Scope and evidence boundaries

Fixtures use synthetic material and a public-domain Alice passage. They exercise UI behavior without paid model work, filesystem export, or real provider audio. Listening quality, live provider performance, persistence and production deployment are outside this presentation review and have not been inferred from fixture success.

## Findings

- Initial foundation has substantial product-state coverage but no standalone component gallery. Added production primitive stories make shared controls independently editable and testable.
- Existing fixture gateway already supported missing cover, refresh failure, running/failed generation, pending voice upload and review recovery, but those states were not surfaced as stories. Added visible entry points instead of inventing alternate page implementations.
- Initial renders exposed inadequate green-tag/complete-stage contrast, tiny ordinary-cast cards with truncated statuses, excessively tall extraction preview panes and a phone rail using unnecessary vertical space. Those observations were sent to the implementation owners and corrected; the final rerender verified the changes.
- Home/import: the illustrated nocturne scene establishes the direction; import and existing books remain distinct actions. Phone art is composed within the hero rather than covering the controls.
- Library: visible edition metadata, complete/partial chapter descriptions, native actions and readable missing-cover fallback. A failed refresh preserves both editions in the browser story.
- Extract: source versus extracted text remain explicit, representative samples stay reachable, tall source panes are independently scrollable and keyboard focusable. The main processing action follows the comparison.
- Dialogue: settings, rule conflicts, source evidence and result summaries retain their different roles. Running state and unresolved attribution do not silently become accepted work.
- Review/final/recovery: flagged text remains source-exact; group-wide versus one-heading consequences are stated explicitly. Unsafe source coverage offers rebuilding and no acceptance action.
- Cast: ordinary voice tiles now have room for names, statuses and listening controls. An independent dense-ensemble review exposed scanning friction; large casts now have name/source-label search and status filters. Browser checks verified that hiding a required group cannot bypass its global gate, and Clear restores the collection and search focus. The inspector bottom was separately captured to inspect all audition candidates and native audio controls.
- Generate: chapter selection, existing/stale/unavailable audio and saved chapters after failure are visible. Contrast is retained for unavailable content rather than fading the entire card.
- Export: chapter selection and edition settings are visually grouped; long-book selection remains independently scrollable. Phone layout stacks settings without horizontal overflow.
- Shared shell/components: desktop stage context and compact phone progress preserve orientation. Native keyboard behavior, tooltip independence, dialog focus lifecycle and equal-specificity host CSS overrides were checked separately.

## Executed verification

On the integrated working tree on 2026-09-26:

- Story type check passed.
- The integration owner executed **234/234** unit tests in 22 files at 22:04:09, and **53/53** Chromium Storybook tests in four files at 22:04:23: 39 product states, 9 primitive stories, 3 workflow composition stories and 2 presentation contracts. Production build, story type check and lint passed; lint retains one existing mixed-export warning in LanguagePicker. [Integration record](../docs/nocturne/evidence/integration.json). Ordinary preview stories use no inherited contrast exclusions; historical exceptions are enabled only for immutable extraction-parity comparisons using `legacyMedia`.
- Independent screenshot/accessibility matrix passed **102/102** desktop/phone renders, including the editable compositions, with no horizontal overflow, browser errors or axe violations. [Persisted report](../docs/nocturne/evidence/design-matrix.json); original full captures: `/tmp/meowdiobooks-design-current/`, including audition inspector bottoms. Broken-image records are confined to the deliberately missing-cover fixture and its readable fallback.
- Packed consumer passed TypeScript composition and both standalone/App-header canonical styling, with 71 packed files. Ordinary host `.primary` overrides won in resting and hover states for both consumers. Executed by the integration and component owners; the independent review preserves their exact host assertions.
- Independent Chinese layout/contrast/overflow passed **14/14** phone/tablet renders across six workflow pages and the voice inspector. [Persisted report](../docs/nocturne/evidence/chinese-layout.json); captures: `/tmp/meowdiobooks-chinese-current/`. Manual inspection found a cramped two-column phone Dialogue layout despite clean automation; the choices now stack. Identified inherited English status/candidate/count fragments were translated and visually rechecked; book/source data and provider names were excluded. This is not a completeness audit of all translations.
- Final manual inspection also removed inherited empty strategy-card height on phones. Four focused English/Chinese Dialogue/recovery captures passed; the affected entries and PNGs replace earlier captures in the matrix, while unchanged captures are retained. [English delta](../docs/nocturne/evidence/final-mobile-strategies.json), [Chinese delta](../docs/nocturne/evidence/final-mobile-strategies-chinese.json), [final phone image](../docs/nocturne/screenshots/dialogue-phone.png), [Chinese phone image](../docs/nocturne/screenshots/dialogue-phone-chinese.png).
- Independent progressive hero checks passed visible rendering, live reduced-motion release, actual GPU buffer disposal, stopped animation scheduling, actual offscreen pause/resume, no-WebGL fallback and a pending-import preference race. Safe standalone preview switching/navigation/refresh stays on `studio.html`, with zero actual `/api/` requests or browser errors. [Persisted report](../docs/nocturne/evidence/preview.json); captures: `/tmp/meowdiobooks-preview-final/`.
- Independent dense collection checks passed source-label/name search, status filtering, no-match recovery, Clear focus and global required gates at desktop and phone widths. Phone inspector background navigation is blocked, draft notes remain, Tab stays inside, and Escape restores the original tile. [Persisted report](../docs/nocturne/evidence/collections.json).
- Independent Dialogue, generation and sample-upload progress checks prove focus entry, Tab trap, active-work preservation on Escape and scrolling lock. Generation cancellation releases scrolling. Completion restoration is not claimed for intentionally pending Dialogue/sample fixtures without a completion control. [Persisted report](../docs/nocturne/evidence/progress.json).
