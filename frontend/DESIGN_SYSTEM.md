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
