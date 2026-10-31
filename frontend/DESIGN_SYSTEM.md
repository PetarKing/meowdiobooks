# Meowdiobooks design system — Matcha & Cherry

Matcha & Cherry is the current application design: an illustrated sanctuary with the reading-cat mascot, two complete appearances and source-linked workflow controls. The contracts below describe the shipped source. Visual fixtures use synthetic data and do not establish backend or deployed-host behavior.

## Foundations

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f1f2e8` | `#15262a` |
| Paper | `#fefff8` | `#253c3d` |
| Copy | `#2d3825` | `#faf3e6` |
| Muted copy | `#5e684f` | `#ccd7d0` |
| Primary action | `#a42f4d` | `#f49bb6` |
| Success | `#436627` | `#b6dcac` |

The authoritative tokens live in `src/styles/appearance.css`. Status colors have matching foreground/background tokens in each appearance. The header has one icon button for appearance. With no preference it follows the OS; clicking sets the opposite explicit appearance for 12 hours and persists its deadline locally. Expiry resumes the current device appearance, including after reload or wake. Its accessible name and pressed state remain available to assistive technology. Hosts can control appearance without changing workflow data. See [the appearance contract](../docs/APPEARANCE.md) for controlled properties, sibling palettes and portal propagation.

The typography roles use locally bundled Geist 1.9.0: Heart for the Home headline, Regular Serif for selected display headings and bibliographic titles, and Sans for interface copy and manuscript passages. The existing serif stack remains the wordmark, monogram and small utility-display fallback. Serif uses its released upright Regular weight; the home emphasis keeps its cherry colour. Fonts use `font-display: swap`, retain system fallbacks, and require no external font service. See the [approved typography roles and screenshots](../docs/reviews/geist-typography.md). A 4px spacing rhythm, restrained borders and modest corner radii support the content. Do not enlarge headings or decorative surfaces at the expense of the first decision.

## Brand artwork

The application serves `src/assets/brand/meowdiobooks-mark.webp`, a lossless copy of the original `meowdiobooks-mark.png` retained beside it; dimensions and decoded pixels are identical. `StudioHero` pairs live HTML copy and import controls with `matcha-kami-sanctuary.webp`: an original illustrated temple precinct, with the same glasses-wearing orange cat reading on its central dais. Sweeping rooflines, moss gardens, cherry lacquer, washi panels and layered architectural detail carry the maximalism. The same art remains visible on phone below the import action. It is decorative and hidden from assistive technology; no functional labels are baked into it.

The artwork is generated with the built-in imagegen tool and encoded as a 539 KB WebP. [The exact prompt](../docs/ASSET_PROVENANCE.md#sanctuary-illustration) records provenance. The illustration depicts an imagined sanctuary, without claiming a real shrine or using decorative Japanese text. A second transparent lantern-and-blossom canopy extends the sanctuary into canonical working-screen headings. Layered background gradients fade it before working content without creating a stacking context that traps dialogs; it is excluded from custom semantic palette roots and stops moving under reduced motion. [Its provenance](../docs/ASSET_PROVENANCE.md#sanctuary-canopy) is recorded separately. The illustrations carry the architectural richness. The shell uses open space, botanical/status colors and simple separators. Avoid adding decorative frames around groups that already have their own controls. The old Three.js sculpture is no longer allocated by the home view.

Artwork never substitutes for names, acceptance state, source evidence or actual audio. Neutral primitives must not import direction artwork.

Native chapter playback publishes chapter, book and author metadata through the browser's Media Session API when playback starts. Its artwork uses the original 512px reading-cat PNG rather than the 192px page favicon, so operating-system media surfaces receive the full-resolution brand mark. The browser owns the final lock-screen presentation and native playback controls. Opening an idle player does not claim the session; closing it clears only metadata that player still owns.

## Character avatars

- Avatars represent cast identity; they do not replace names, roles, or acceptance state.
- Color and shape must be deterministic from a stable character identifier, never list position. Initials remain the accessible fallback until durable portrait assets exist.
- Emotional avatar states may decorate future playback, but must not alter Character or Review decisions.
- In the current Cast roster, the initials are the preview Play/Stop target; a seven-bar sound motif replaces them only during playback. The small play cue disappears while playing, with no pause icon; clicking the same field stops playback and restores the initials. The rest of the complete card surface opens the inspector, including its padding. Selected and required marks remain visible without repeating status or line-count text on every card, and both controls retain accessible names and states.
- Do not use generated portraits that imply unsupported age, gender, ethnicity, or story facts.

## Interaction and state

- Every interactive element needs visible hover, keyboard focus, selected, and disabled treatment. Use one focus indicator per target. Whole-row Generate and Export selections own their indicator; their inner checkbox does not add another ring. Selection retains native checkmarks/radios alongside color.
- Dialogs initially focus their reading surface without an outline. Controls retain a visible keyboard indicator when reached with Tab; autofocus remains appropriate for an explicit editing or playback action.
- All modal backdrops use `DialogBackdrop`, a body portal that preserves the originating `PresentationRoot` appearance and semantic palette. Its shared scrim covers the complete viewport above shell headers and footers; hosts may supply visual tokens through its ordinary `style` prop when outside a presentation context. Small confirmations compose it with `DialogSurface`, `dialog-card` and `dialog-actions` from the public primitive sheet. The card provides padding, bounded width/height and internal scrolling; full workbench inspectors keep their own geometry. `DialogSurface` owns the shared keyboard lifecycle, background inert isolation and reference-counted document/body scroll lock, retaining the page position until the last modal closes. Nested portals keep only the last surface interactive. The lifecycle registry belongs to the document under a versioned shared symbol so independently bundled App and `/ui` entry points cannot release each other’s locks or trap each other’s focus during a host handoff. Progress dialogs omit `onDismiss` so Escape never cancels a job. Hosts retaining a native modal can consume `useModalScrollLock` from `/ui`, though native dialogs must own their own focus lifecycle.
- Loading preserves context: keep the initiating label, add progress when measurable, and prevent duplicate actions.
- Empty states explain what unlocks the surface. Library load failures have their own Retry state and never claim the library is empty; failed refresh retains the last successful editions. Errors are announced, visually anchored in red, and retain user work. Warnings use amber; success uses sage.
- Progress and completion use calm, brief motion. The home sanctuary illustration is static and allocates no animation loop or WebGL context. The decorative canopy shifts by only a few pixels over 18 seconds and stops under reduced motion. Task screens use purposeful hover, selection and transition feedback. Never animate an acceptance state into ambiguity.
- `prefers-reduced-motion` disables transforms, looping animation, and nonessential transitions. State changes must remain legible without motion.

## Responsive behavior

- Wide layouts favor clear comparison with generous space. Tablet retains the stage rail; phone uses a slim connected row of evenly spaced numbered progress markers, with the current step in a cherry pill. Position remains available to assistive technology without repeating the page title. The standard six-step journey fits at 320px with 44px touch targets; longer host journeys can scroll. Accessible names retain every stage label and status.
- Generate chapter rows use an inset mobile layout, one audio-readiness label and a separate 44px Listen target. Gold marks current generated audio or a host-confirmed current purchase scope; the label continues to describe actual audio, never payment. Ready audio says Generated, and paid audio that has not finished remains To make or Older recording.
- Generate actions sit 16px above the viewport foot with safe-area padding. A measured spacer places short-list actions there; long lists retain a compact bottom-sticky dock, and their final row remains reachable above it.
- On mobile, primary actions remain reachable without covering the final content. Horizontal choice rails must show more than one card edge so overflow is discoverable.
- Desktop entrance artwork shares the screen with the import composition; phone stacks the illustration below the import action. Modal inspectors cover the complete viewport so background navigation cannot discard work. Large ensembles use search and status filtering while total acceptance requirements stay visible. Text stays live and left aligned on narrow screens.

## Product boundaries

Visual changes must not reinterpret Character acceptance, Review decisions, warning severity, recording-script state, or generation status. Those are product semantics, not decoration.

## Shared source and presentation boundary

Production pages are ordinary React compositions under `src/pages`; their typed models
select the state and commands they need from the application workflow model. Storybook
renders those same production components with deterministic synthetic gateways. Fixtures
are review evidence, not evidence of backend generation or acceptance.

`PresentationRoot` owns one visual root. With no palette it renders the canonical studio
presentation, scoped to its resolved light or dark appearance. Its optional `PresentationPalette` contains only semantic colour values;
it cannot change navigation, capabilities, commands, acceptance or layout. Shared controls
and page styles consume `--color-action`, `--color-action-hover`, `--color-ink`,
`--color-muted`, `--color-paper`, `--color-border`, `--color-success` and
`--color-warning`, with public tokens as their defaults. Palette values remain optional; they do not grant workflow authority.

Use sibling roots for palette comparison. Nested roots throw because a nested selector
cannot isolate arbitrary ancestor CSS. Full art-direction comparisons belong in separate
Storybook frames. Page geometry belongs in page/component styles, and illustrations
belong in explicit compositions or slots; neutral controls must not import direction art.

## Public consumer stylesheet contract

New consumers import `meowdiobooks-workflow-ui/product.css` once, then their host CSS.
The application component deliberately does not import the full stylesheet. The public
entry includes the built-in component styles, legacy global styles, responsive media
styles and dialog focus treatment, followed by canonical primitive, page and studio compositions, without cascade layers. Ordinary host
rules of equal specificity loaded afterwards retain priority. A primitive-only consumer
imports the same entry and imports controls from `meowdiobooks-workflow-ui/ui`.

The existing `styles.css` and `media.css` exports remain compatible for hosts using the
legacy pair. Do not import both the canonical entry and the legacy pair. Existing legacy
variables such as `--poppy` remain valid; optional semantic values override only the
surfaces that opt into them. A future release may reorganize internal CSS, but must retain
this consumer ordering and verify computed host override priority.

Optional gateway methods `sourcePageImageUrl`, `libraryCoverImageUrl` and
`layeredVoicePreviewUrl` allow hosts and fixtures to resolve media. When omitted, the
exact existing HTTP routes remain in use. These methods do not grant access, choose
accepted revisions or imply media readiness. Host edition copy remains the existing
31-key contract; no footer policy claims are added by the foundation.

Run `node scripts/verify-host-consumer.mjs` from `frontend` to pack the exact candidate
and verify it from a temporary external consumer. The check compiles the fixed host
translation/hook contract through public exports, then uses Chromium to confirm both
standalone primitives and App host controls receive the baseline stylesheet and respect
an ordinary equal-specificity `.primary` rule imported afterward. It requires installed
frontend dependencies and Playwright Chromium; it removes its temporary project on exit.


Book returns show a quiet localized status immediately. Book art and its atmosphere appear only
after 800 ms of unresolved restoration; this is a decoration threshold, never a minimum wait or
a reason to delay content. The return cover stays until an active job's authenticated scope is known,
so ordinary default selections cannot appear as the resumed request. Graphics are optional: failed
loading or WebGL keeps the readable status, and completion or navigation removes the scene.

## Iteration ownership

- `styles.css` contains public token defaults and the existing shared layout baseline. `media.css` preserves the legacy responsive contract.
- `styles/appearance.css` owns both scoped appearances, semantic defaults and native color schemes.
- `styles/primitives.css` owns canonical shared controls. Use `Button`, `Panel`, `Choice`, `Tag`, `TabList`, `DialogSurface` and `SourceExcerpt` instead of inventing parallel variants.
- `styles/pages.css` owns workflow geometry and compositions. `StepIntro`, `WorkflowLaunch` and `WorkflowEmpty` are production components with their own stories. Large cast collections share `CollectionToolbar`.
- `styles/cast-roster.css` owns the shared Cast/Voices card: curved tinted monogram field, status spine and consistent phone text alignment. `styles/roster-motion.css` owns its curve drawing, accent sheen and staggered playback cadence.
- `styles/cast-workbench.css` preserves shared Cast geometry; `styles/cast-stage.css` owns the canonical character-select roster, audition cards, New voice source switch and Cast confirmation styling. An audition card applies its exact revision immediately in draft UI; accepting the Cast stage remains a separate explicit workflow action.
- `styles/generate-stage.css` owns the selectable chapter score and generation footer. `styles/export-stage.css` owns the cover proof, book details, contents, format choices and creation receipt.
- `styles/studio.css` owns the shell, entrance art and local-books shelf. `styles/review-extract-stage.css` owns the complete source-page preview and Review scan scene. `styles/atmosphere.css` owns decorative stage art; it checks the custom-palette marker on `PresentationRoot`. Keep this direction out of shared primitive source.
- Update the owning canonical sheet; do not append ad hoc overrides to `product.css`. Some baseline declarations remain for legacy import compatibility; this is an explicit transition boundary, not a claim that all old CSS has been eliminated.
- `studio.html` is a separate synthetic review entry. `npm run studio` starts it without an API proxy; its navigation stays on the fixture entry after refresh. Production `index.html` and its real gateway remain unchanged.
- [Workflow interaction decisions](../docs/INTERACTION_DECISIONS.md) preserve acceptance, playback, candidate and export boundaries. A new component needs a useful isolated story; a new product state needs a realistic gateway-backed story. Regenerate visual evidence with the commands in [frontend development](README.md); store local captures outside tracked documentation.


### Review evidence and suggested choices

Review reuses `SourceExcerpt` as one compact passage surface. Source-anchored evidence tagged
`contextLayout: "continuous"` shows the paragraph containing the target, with no unrelated outer
paragraphs. A short standalone target also gets the nearest brief paragraph on either side, bounded
to 140 characters each. Legacy evidence without that marker keeps separate, unlabeled snippets
inside the same surface; never infer missing spaces or speaker names. Single line breaks and verse
remain visible; excess empty lines collapse for display only. Source evidence, offsets and review
actions are unchanged. Only the anchored target is highlighted.

Do not repeat an AI proposal in a separate correction panel or explanatory paragraphs below the passage.
Deletion proposals mark Leave as suggested; word repairs show the exact replacement inside Apply correction,
after Keep and Leave and before the separate bulk action.

A suggested individual choice remains visually neutral and adds “(Suggested)” to its title; only an
explicit choice uses the action tint and checkmark. Do not preselect suggestions or count them as
decisions. Show bulk suggestions only when the action covers more than one suggestion in total;
a larger review keeps its bulk action even when just one undecided suggestion remains.
Use a full-width warning-tinted block with a nearby icon and left-aligned title, no extra help paragraph.
On wide layouts, push this block to the bottom of the decision sidebar with flexible space above;
keep it in normal flow after the options on smaller screens or when the options fill the sidebar.
Explain preservation in the accessible description and tooltip. At zero, show “All suggestions decided”.
Bulk application preserves manual choices. At zero, disable only the bulk button and explain that
individual choices remain editable. Do not add a duplicate selection-status line below the choices.

Chapter-start evidence displays all supplied bounded context so a title split across paragraphs
and its opening passage remain visible. Only the original boundary anchor is highlighted; this
presentation does not merge source spans or rewrite extracted text. PDF review offers an on-demand
original-page dialog through the existing host media resolver, with page navigation and retry.

The Review action area reports completion across all categories. While decisions remain, its primary
action opens the first unresolved heading or text decision and focuses the evidence below the header.
Completing suggested choices is distinct from completing a category or the whole review. On phones
the action area stays at the viewport foot while reading; the final controls remain scrollable above
it. The complete-transcript preview and explicit acceptance remain separate steps.
