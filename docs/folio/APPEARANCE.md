# Folio appearance contract

Folio has two complete visual appearances: warm paper with graphite copy and vermilion actions,
and charcoal with ivory copy and peach actions. Both retain separate teal success, amber attention
and red destructive/error states. Appearance changes presentation only.

## Preference and host control

The default `App` header exposes an accessible native **Light / Dark / System** select. System follows
`prefers-color-scheme` and updates when the operating-system preference changes. User choices persist
under `meowdiobooks.appearance` in browser local storage. Malformed or unavailable storage falls back
to System; blocked writes still allow changing the current UI. This preference is not part of book,
workflow, accepted artifacts or backend state.

Hosts can supply `appearance?: 'light' | 'dark' | 'system'` and
`onAppearanceChange?: (appearance) => void`. A supplied appearance is authoritative, and selecting
another option invokes the callback without changing or persisting the controlled value. The host
may expose its own control when using a custom header. Deterministic previews explicitly choose
Light or Dark rather than relying on OS or stored preferences.

## Scoped CSS and portals

`PresentationRoot` accepts `appearance?: 'light' | 'dark'`, defaulting to Light. Each root owns its
visual tokens and `color-scheme`, including native inputs, selects and audio. Sibling roots may show
different appearances and palettes simultaneously. Nested presentation roots remain prohibited.

The Phase Help dialog portals to `document.body`. Its existing backdrop receives the originating
root's appearance and visual custom properties through the internal presentation context. Geometry
is not copied, and no global document theme is set. Other current dialogs remain inside their root.

Supplied `PresentationPalette` semantic colors remain authoritative in both modes. Appearance
provides defaults; it does not rewrite palette values. Hosts retain ordinary CSS override priority.
The public legacy `styles.css` imports the same appearance defaults, while the canonical `product.css`
imports the complete product compositions. Existing edition translations retain their 31-key contract.

The default primary foreground is `--action-ink`: ivory on the light vermilion action and graphite on
the dark peach action. A host supplying another action palette may set that ordinary CSS token to its
own matching foreground. Destructive actions use separate `--danger-action` and
`--danger-action-ink` tokens. Source highlights explicitly set both foreground and background;
HTML's default black `<mark>` foreground must not leak into Dark.

## Evidence and reproduction

- `src/app/useAppearance.test.tsx` verifies restored and invalid preferences, blocked storage,
  controlled host settings, system updates and listener cleanup.
- `src/components/ThemeToggle.test.tsx` verifies the accessible native three-option choice.
- `src/components/PresentationRoot.test.tsx` verifies sibling isolation, supplied palette preservation
  and the existing nesting prohibition.
- `src/components/PhaseHelp.test.tsx` verifies portal appearance and custom-token propagation without
  copying root geometry, plus the existing keyboard/focus lifecycle.
- `stories/Presentation.stories.tsx` verifies real Chromium computed colors, color schemes, sibling
  palettes and ordinary host override priority.
- `scripts/verify-appearance.mjs` renders production CSS against synthetic solid-surface controls and
  source/error/recovery states. It measures composited contrast in Chromium and fails below 4.5:1.
  Its actual execution report is [evidence/appearance.json](evidence/appearance.json). This probe
  complements the full product story audit; it does not exercise a backend workflow.

Run these commands from `frontend`:

```sh
npm test -- --run src/app/useAppearance.test.tsx src/components/ThemeToggle.test.tsx src/components/PresentationRoot.test.tsx src/components/PhaseHelp.test.tsx
npm run test-storybook -- stories/Presentation.stories.tsx
node scripts/verify-appearance.mjs
```

Component and product Storybook frames support `?appearance=light` and `?appearance=dark` for
repeatable desktop and phone review. `scripts/review-design.mjs` receives appearance as its sixth
command argument after preview URL, output directory, story filter and locale.

## Live preference transition follow-up

The isolated [System appearance check](evidence/system-appearance/report.json) exercised eight transitions against `2aeeac9`: System followed live emulated light/dark OS preferences; explicit Light and Dark stayed explicit; Dark persisted after reload; returning to System resumed following the OS preference. The verifier waits for settled background and text colors as well as the appearance attribute and native color scheme. No actual OS setting, user tab preference, provider or production API was changed. Reproduce with `node frontend/scripts/verify-system-appearance.mjs`.
