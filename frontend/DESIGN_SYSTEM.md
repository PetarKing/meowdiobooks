# Meowdiobooks design system — Folio

Folio is a warm literary/audio workshop. Paper, graphite, vermilion and teal give the light appearance a tactile identity; charcoal, ivory and peach carry that identity into dark mode. Working screens prioritize evidence and the next decision. The user rejected the preceding Nocturne direction; its artwork and reviews remain historical. This rebuild is a local review candidate, not aesthetic acceptance or production adoption.

## Foundations

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f4f1eb` | `#181e20` |
| Paper | `#fffdf8` | `#222a2c` |
| Copy | `#252b2c` | `#f1eee5` |
| Muted copy | `#626967` | `#b3bdb8` |
| Primary action | `#b94630` | `#f0a080` |
| Success | `#286354` | `#86c7ad` |

The authoritative tokens live in `src/styles/appearance.css`. Status colors have matching foreground/background tokens in each appearance. Light/Dark/System is an accessible header select; System follows OS changes and user preferences persist locally. Hosts can control appearance without changing workflow data. See [the appearance contract](../docs/folio/APPEARANCE.md) for controlled properties, sibling palettes and portal propagation.

Working headings use the offline-safe humanist sans stack at approximately 32px. Home and bibliographic titles use the editorial serif stack. Source excerpts preserve readable manuscript typography. A 4px spacing rhythm, restrained borders and modest corner radii support the content. Do not enlarge headings or decorative surfaces at the expense of the first decision.

## Brand artwork

The existing `src/assets/brand/meowdiobooks-mark.png` remains the application mark. The home composition uses live HTML plus a code-native open book and audio waves. `StudioHero` provides static CSS paper leaves; `SoundField` progressively adds a lazy Three.js sculpture. Phone keeps a compact book/wave emblem instead of allocating the hidden desktop sculpture. The rejected Nocturne bitmap is no longer imported.

Artwork never substitutes for names, acceptance state, source evidence or actual audio. Neutral primitives must not import direction artwork.

## Character avatars

- Avatars represent cast identity; they do not replace names, roles, or acceptance state.
- Color and shape must be deterministic from a stable character identifier, never list position. Initials remain the accessible fallback until durable portrait assets exist.
- Emotional avatar states may decorate future playback, but must not alter Character or Review decisions.
- Do not use generated portraits that imply unsupported age, gender, ethnicity, or story facts.

## Interaction and state

- Every interactive element needs visible hover, keyboard focus, selected, and disabled treatment. Selection uses shape/border plus color.
- Small confirmations can compose `DialogSurface` with `dialog-backdrop`, `dialog-card` and `dialog-actions` from the public primitive sheet. The card provides padding, bounded width/height and scrolling; full workbench inspectors keep their own geometry. `DialogSurface` itself owns the shared keyboard and scroll-lock lifecycle.
- Loading preserves context: keep the initiating label, add progress when measurable, and prevent duplicate actions.
- Empty states explain what unlocks the surface. Errors are announced, visually anchored in red, and retain user work. Warnings use amber; success uses sage.
- Progress and completion use calm, brief motion. Ambient motion is allowed only in decorative home artwork: the lazy Three.js book sculpture caps rendering at 30fps, pauses while hidden or offscreen, and releases its GPU context on unmount. Task screens use purposeful hover, selection and transition feedback. Never animate an acceptance state into ambiguity.
- `prefers-reduced-motion` disables transforms, looping animation, and nonessential transitions. State changes must remain legible without motion.

## Responsive behavior

- Wide layouts favor comparison and review density. Tablet retains the stage rail; phone uses one scrollable named stage rail in the header.
- On mobile, primary actions remain reachable without covering the final content. Horizontal choice rails must show more than one card edge so overflow is discoverable.
- Desktop entrance artwork enhances the compact import composition; phone retains a small book/wave emblem. Modal inspectors cover the complete viewport so background navigation cannot discard work. Large ensembles use search and status filtering while total acceptance requirements stay visible. Text stays live and left aligned on narrow screens.

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
- `styles/cast-workbench.css` owns cast collection rows and audition-first inspector geometry.
- `styles/studio.css` owns the shell and entrance art. Keep this direction out of shared primitive source.
- Update the owning canonical sheet; do not append ad hoc overrides to `product.css`. Some baseline declarations remain for legacy import compatibility; this is an explicit transition boundary, not a claim that all old CSS has been eliminated.
- `studio.html` is a separate synthetic review entry. `npm run studio` starts it without an API proxy; its navigation stays on the fixture entry after refresh. Production `index.html` and its real gateway remain unchanged.
- [Folio review](../docs/folio/REVIEW.md) records the current independent rendered critique; [workflow evidence](../docs/folio/WORKFLOWS.md) records screen-specific execution. Earlier `design-review.md` and `design-review-pages.md` describe the rejected Nocturne candidate. A new component needs a useful isolated story; a new product state needs a realistic gateway-backed story.
