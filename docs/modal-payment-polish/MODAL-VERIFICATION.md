# Shared modal isolation verification

Date: 2026-10-04. Source candidate: local `codex/modal-payment-polish`, based on main
`cdefb3c`; uncommitted implementation, no release or consumer adoption implied.

Every Core modal backdrop now uses `DialogBackdrop`, a presentation-preserving body portal.
`DialogSurface` retains its public section/div rendering and dismissal behavior while owning
background inert isolation, keyboard containment and reference-counted root/body scroll locking.
Closing the last modal restores the document position and original inline style priorities.
Long surfaces scroll internally; progress dialogs still do not interpret Escape as cancellation.
Legacy Cast inspectors now return explicit focus after unmount and use a surface ref for
portal-local scroll reset.

## Executed checks

- `npm --prefix frontend test -- --run`: 32 files, 361 tests passed.
- `npm --prefix frontend run build`: passed. Existing large-chunk warning remains.
- `npm --prefix frontend run storybook:check`: passed.
- `npm --prefix frontend run lint`: zero errors; existing LanguagePicker fast-refresh warning remains.
- `git diff --check`: passed.
- `node frontend/scripts/verify-host-consumer.mjs`: passed against the exact packed public source.
  The sandbox initially blocked localhost binding; an approved escalated run executed the probe.
  Host TypeScript compatibility, ordinary equal-specificity CSS overrides and handled/delegated/declined
  action-required behavior passed in development and production builds.

The host probe runs Chromium with a transformed application ancestor and deliberately high-z-index
fixed host header/footer. It checks six modal scenarios:

| Viewport | Appearance | Tall surface height | Measured internal scroll | Covered viewport corners |
| --- | --- | ---: | ---: | --- |
| 1440 × 900 | light and dark | 868px | 499px | all four |
| 390 × 844 | light and dark | 812px | 555px | all four |
| 320 × 480 | light and dark | 448px | 600px | all four |

In each scenario, opening at document position 500px fixed the body at `top: -500px` and hid
root overflow. Wheel input over the backdrop left the document stationary; wheel input over the
surface scrolled its content. Nested Escape returned focus to the outer opener while retaining
scroll locking; final Escape returned focus to the original page action and restored document
position 500px. A supplied semantic paper palette survived the portal. No browser page errors occurred.

The focused component regressions also cover non-dismissible progress, changing busy dismissal
rules, initially nested mounts, hidden controls, sibling unmount order, pre-existing inert state,
late-added background elements, stray programmatic focus and inline-style priority restoration.

These synthetic checks establish the reusable primitive behavior; they do not establish a
physical-device Safari result, authenticated staging behavior, payment execution, deployment or release.
