# Meowdiobooks design system

Meowdiobooks should feel like a small, meticulous literary workshop: warm and magical at the edges, calm and operational at the center. Delight must never obscure source review, warnings, progress, or irreversible choices.

## Foundations

- **Ink:** aubergine `#33253b`; primary copy and dark branded surfaces.
- **Paper:** parchment `#fffdf8` over canvas `#f7f0e5`; avoid sterile pure-white pages.
- **Action:** poppy `#ed6659`, darkening to `#c94345`; reserved for primary action and current selection.
- **Success:** sage `#447867`; completed, accepted, and locally available states.
- **Attention:** honey `#efb44c` / amber `#a56c20`; warnings and magical illustration details, never destructive action.
- **Display type:** the platform's editorial old-style serif stack. **UI type:** the platform's rounded humanist sans stack. Both remain offline-safe.
- Use a 4px spacing rhythm. Primary control heights start at 40px; body copy must not drop below 12px and operational labels should normally be 10px or larger.
- Corners are bookish, not bubbly: 10px controls, 16px cards, 24px feature panels. Slight asymmetry is allowed only on decorative cat containers.
- Elevation has three levels: subtle interactive lift, card separation, and modal/hero focus. Never stack multiple pronounced shadows.

## Brand artwork

- `src/assets/brand/meowdiobooks-mark.png` is the application mark. Preserve its aspect ratio and give it a warm paper container when shown below 64px.
- `src/assets/brand/meowdiobooks-hero.png` is the narrative hero. Keep the cat on the right and reserve the dark left field for live HTML copy. Never bake product text into artwork.
- Generated illustration is reserved for identity and narrative moments. Controls, indicators, icons, and layout primitives remain code-native.
- Cat imagery is clever and cozy, never babyish: capable expressions, tactile editorial texture, restrained props, no meme language.

## Character avatars

- Avatars represent cast identity; they do not replace names, roles, or acceptance state.
- Color and shape must be deterministic from a stable character identifier, never list position. Initials remain the accessible fallback until durable portrait assets exist.
- Emotional avatar states may decorate future playback, but must not alter Character or Review decisions.
- Do not use generated portraits that imply unsupported age, gender, ethnicity, or story facts.

## Interaction and state

- Every interactive element needs visible hover, keyboard focus, selected, and disabled treatment. Selection uses shape/border plus color.
- Loading preserves context: keep the initiating label, add progress when measurable, and prevent duplicate actions.
- Empty states explain what unlocks the surface. Errors are announced, visually anchored in red, and retain user work. Warnings use amber; success uses sage.
- Progress and completion use calm, brief motion. No ambient looping decoration.
- `prefers-reduced-motion` disables transforms, looping animation, and nonessential transitions. State changes must remain legible without motion.

## Responsive behavior

- Wide layouts favor comparison and review density. Tablet retains the stage rail; mobile replaces it with named progress.
- On mobile, primary actions remain reachable without covering the final content. Horizontal choice rails must show more than one card edge so overflow is discoverable.
- Brand artwork may crop, but the cat, book, and microphone must remain recognizable. Text stays live and left aligned on narrow screens.

## Product boundaries

Visual changes must not reinterpret Character acceptance, Review decisions, warning severity, recording-script state, or generation status. Those are product semantics, not decoration.

## Shared source and presentation boundary

Production pages are ordinary React compositions under `src/pages`; their typed models
select the state and commands they need from the application workflow model. Storybook
renders those same production components with deterministic synthetic gateways. Fixtures
are review evidence, not evidence of backend generation or acceptance.

`PresentationRoot` owns one visual root. With no palette it renders accepted-main
presentation. Its optional `PresentationPalette` contains only semantic colour values;
it cannot change navigation, capabilities, commands, acceptance or layout. Shared controls
and page styles consume `--color-action`, `--color-action-hover`, `--color-ink`,
`--color-muted`, `--color-paper`, `--color-border`, `--color-success` and
`--color-warning`, with existing public tokens as their unchanged defaults.

Use sibling roots for palette comparison. Nested roots throw because a nested selector
cannot isolate arbitrary ancestor CSS. Full art-direction comparisons belong in separate
Storybook frames. Page geometry belongs in page/component styles, and illustrations
belong in explicit compositions or slots; neutral controls must not import direction art.

## Public consumer stylesheet contract

New consumers import `meowdiobooks-workflow-ui/product.css` once, then their host CSS.
The application component deliberately does not import the full stylesheet. The public
entry includes the built-in component styles, accepted global styles, responsive media
styles and dialog focus treatment in that order, without cascade layers. Ordinary host
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
