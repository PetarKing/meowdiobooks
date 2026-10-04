# Meowdiobooks design system — Matcha & Cherry

The user selected Matcha & Cherry, with a Japanese-inspired maximalist sanctuary and the existing reading cat imagined as a benevolent local kami. Folio and Nocturne are rejected art directions; their review records are historical. The stagecraft iteration is the current local implementation candidate: it retains the butterfly shell, rebuilds the Cast voice roster/auditions and Review return, restores full PDF pages, and adds restrained working-stage atmosphere. Visual selection is not production adoption.

## Foundations

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f1f2e8` | `#15262a` |
| Paper | `#fefff8` | `#253c3d` |
| Copy | `#2d3825` | `#faf3e6` |
| Muted copy | `#5e684f` | `#ccd7d0` |
| Primary action | `#a42f4d` | `#f49bb6` |
| Success | `#436627` | `#b6dcac` |

The authoritative tokens live in `src/styles/appearance.css`. Status colors have matching foreground/background tokens in each appearance. The header has one icon button for appearance. With no preference it follows the OS; clicking sets the opposite explicit appearance and persists locally. Its accessible name and pressed state remain available to assistive technology. Hosts can control appearance without changing workflow data. See [the appearance contract](../docs/folio/APPEARANCE.md) for controlled properties, sibling palettes and portal propagation.

Working headings, home titles and bibliographic titles use the offline-safe editorial serif stack; supporting copy and controls use the humanist sans stack. Source excerpts preserve readable manuscript typography. A 4px spacing rhythm, restrained borders and modest corner radii support the content. Do not enlarge headings or decorative surfaces at the expense of the first decision.

## Brand artwork

The existing `src/assets/brand/meowdiobooks-mark.png` remains the application mark. `StudioHero` pairs live HTML copy and import controls with `matcha-kami-sanctuary.webp`: an original illustrated temple precinct, with the same glasses-wearing orange cat reading on its central dais. Sweeping rooflines, moss gardens, cherry lacquer, washi panels and layered architectural detail carry the maximalism. The same art remains visible on phone below the import action. It is decorative and hidden from assistive technology; no functional labels are baked into it.

The artwork is generated with the built-in imagegen tool and encoded as a 539 KB WebP. [The exact prompt](../docs/matcha-sanctuary/ART-PROMPT.md) records provenance. The illustration depicts an imagined sanctuary, without claiming a real shrine or using decorative Japanese text. A second transparent lantern-and-blossom canopy extends the sanctuary into canonical working-screen headings. Layered background gradients fade it before working content without creating a stacking context that traps dialogs; it is excluded from custom semantic palette roots and stops moving under reduced motion. [Its provenance](../docs/matcha-next/ASSET-PROVENANCE.md) is recorded separately. The illustrations carry the architectural richness. The shell uses open space, botanical/status colors and simple separators. Avoid adding decorative frames around groups that already have their own controls. The old Three.js sculpture is no longer allocated by the home view.

Artwork never substitutes for names, acceptance state, source evidence or actual audio. Neutral primitives must not import direction artwork.

## Character avatars

- Avatars represent cast identity; they do not replace names, roles, or acceptance state.
- Color and shape must be deterministic from a stable character identifier, never list position. Initials remain the accessible fallback until durable portrait assets exist.
- Emotional avatar states may decorate future playback, but must not alter Character or Review decisions.
- In the current Cast roster, the initials are the preview Play/Stop target; a seven-bar sound motif replaces them only during playback. The small play cue disappears while playing, with no pause icon; clicking the same field stops playback and restores the initials. The rest of the complete card surface opens the inspector, including its padding. Selected and required marks remain visible without repeating status or line-count text on every card, and both controls retain accessible names and states.
- Do not use generated portraits that imply unsupported age, gender, ethnicity, or story facts.

## Interaction and state

- Every interactive element needs visible hover, keyboard focus, selected, and disabled treatment. Use one focus indicator per target. Whole-row Generate and Export selections own their indicator; their inner checkbox does not add another ring. Selection retains native checkmarks/radios alongside color.
- Dialogs initially focus their reading surface without an outline. Controls retain a visible keyboard indicator when reached with Tab; autofocus remains appropriate for an explicit editing or playback action.
- Small confirmations can compose `DialogSurface` with `dialog-backdrop`, `dialog-card` and `dialog-actions` from the public primitive sheet. The card provides padding, bounded width/height and scrolling; full workbench inspectors keep their own geometry. `DialogSurface` itself owns the shared keyboard and scroll-lock lifecycle.
- Loading preserves context: keep the initiating label, add progress when measurable, and prevent duplicate actions.
- Empty states explain what unlocks the surface. Library load failures have their own Retry state and never claim the library is empty; failed refresh retains the last successful editions. Errors are announced, visually anchored in red, and retain user work. Warnings use amber; success uses sage.
- Progress and completion use calm, brief motion. The home sanctuary illustration is static and allocates no animation loop or WebGL context. The decorative canopy shifts by only a few pixels over 18 seconds and stops under reduced motion. Task screens use purposeful hover, selection and transition feedback. Never animate an acceptance state into ambiguity.
- `prefers-reduced-motion` disables transforms, looping animation, and nonessential transitions. State changes must remain legible without motion.

## Responsive behavior

- Wide layouts favor clear comparison with generous space. Tablet retains the stage rail; phone shows the current step above evenly spaced numbered progress markers. The standard six-step journey fits at 320px with 44px touch targets; longer host journeys can scroll. Accessible names retain every stage label and status.
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
- [Stagecraft review](../docs/matcha-next/README.md) records the current rendered evidence. [Butterfly review](../docs/matcha-butterfly/REVIEW.md) records the preceding candidate. [Sanctuary review](../docs/matcha-sanctuary/REVIEW.md) records the preceding candidate. [Folio review](../docs/folio/REVIEW.md) and [workflow evidence](../docs/folio/WORKFLOWS.md) are historical records of the preceding candidate. Earlier `design-review.md` and `design-review-pages.md` describe the rejected Nocturne candidate. A new component needs a useful isolated story; a new product state needs a realistic gateway-backed story.
