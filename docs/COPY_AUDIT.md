# Workflow copy audit

The October 2026 audit covers the shared user interface, both English and Simplified Chinese:
Import/Home, Extract, Dialogue and its result review, Review and final check, Cast and audition
review, Generate, Export, Library, stage help, progress overlays, recovery notices, and errors.

## Ownership

The reusable workflow owns its copy, localization, explanatory text, and presentation capabilities.
This change belongs in the public workflow source. No hosted credentials, endpoint configuration,
provider experiments, or deployment settings are introduced here. Hosts adopt this source through
an immutable workflow release and their normal verified release pin; these source changes do not
by themselves update a deployed application.

## Changes and retained choices

- Review explains suggested corrections and the user's approval without naming a supplier,
  API, or model. It retains truthful disclosure that passages are checked using an online service.
- Extract describes standard reading, embedded PDF text, and complex layouts. The three existing
  extraction methods, their saved IDs, previews, and acceptance behavior remain intact.
- Dialogue describes detected formats, overlapping matches, uncertain speakers, and narrator lines.
  `advancedDialogueRules: false` hides both the custom regular-expression editor and the unknown-
  speaker pattern editor. Visual examples, rule toggles, speaker choices, and corrections remain.
- Cast and Export describe auditions and downloadable formats without exposing artifact recipes,
  revision terminology, or encoder settings. `showVoiceModelControls: false` hides model choices
  and model receipts, including enhanced casting choices. Existing choices are preserved; an
  unavailable previous setup offers an explicit refresh action.
- Help text reflects the current Review scope (individual suggestions as well as grouped choices)
  and the Generate label `Needs update`.
- Old service progress messages map to readable activity descriptions. Unknown adapter progress
  receives a neutral working status. Dynamic counts and character names remain visible.
- Reviewed actionable errors retain their recovery instructions: file limits, source re-import,
  voice language, saved audition continuation, capacity/support, and supported host recovery.
  Unknown service exceptions receive a friendly retry message. Typed host actions still retain
  their public message and are hidden only when the host has handled them.
- Generated explanations in Review and Cast receive a fallback when they contain operational
  details. This filter never applies to book passages, book titles, character names, or user input.
- Existing operator choices remain available in installations that enable them. Local/online
  routing, local setup guidance, and explicit provider cost receipts are existing capabilities;
  hosted compositions should keep those disabled where users cannot configure those services.

Some legacy translation lookup keys remain for saved or older service messages. Their presence
in a translation catalog is not evidence that they appear in an ordinary rendered workflow.
Backend diagnostic records and wire identifiers remain available for operators and debugging.

## Regression evidence

The focused tests cover bilingual provider progress and unknown diagnostics, preserved character
names and progress counts, actionable source/voice errors, typed host recovery, saved-voice
continuation, and hidden expert editors with usable visual controls. Existing application tests
continue to exercise extraction preview choices, acceptance, retry/recovery, and saved state.

Validated during implementation:

- `npm test -- src/App.test.tsx`: 183 tests passed.
- `npm test -- src/api/actionRequired.test.ts src/workflow/presentation.test.ts src/pages/DialoguePage.test.tsx`:
  20 tests passed.
- `npm test -- src/workflow/presentation.test.ts src/pages/DialoguePage.test.tsx src/i18n.test.tsx src/components/CastingChoice.test.tsx`:
  37 tests passed.

Final combined validation: `npm run build` passed; `npm run lint` passed with the existing
LanguagePicker fast-refresh warning; `npm test` passed all 461 tests in 36 files.
The browser check covered 48 synthetic screens across English/Chinese and desktop/mobile, plus
36 stage-help dialogs and four expanded dialogue-rule views, with no browser errors or exposed
technical copy. This verifies UI presentation; no extraction/inference contract changed and no
paid inference was run. Release-consumer and deployment verification remain separate gates.

The Review screenshots use the same public fixture book and neutral presentation capabilities:
[before](assets/review/copy-audit/review-before.png),
[after](assets/review/copy-audit/review-after.png). They contain no private user content.

Additional repository gates passed: `npm run storybook:check`, `npm run build-storybook`,
71 Storybook interaction tests, the packed-package `test:consumer` development/production
checks, and all 96 `visual:review` cases across light/dark desktop/mobile. The local
Storybook run used installed Chrome; consumer/visual gates used the pinned Playwright
browser downloaded into a temporary directory. Synthetic consumer assertions now expect
the safe progress fallback instead of raw internal job wording.

Combined-release review with EPUB/text import support replaced PDF-specific Review and recovery
instructions with source-document wording. Reviewed import errors retain their useful format,
encoding, size, and empty-document guidance in both languages; technical diagnostics remain hidden.
After these integration edits, the full frontend suite passed 465 tests, build and lint passed,
and 12 bilingual desktop/mobile Review and recovery screens passed browser verification.
