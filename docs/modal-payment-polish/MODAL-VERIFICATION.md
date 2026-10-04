# Shared modal isolation verification

Date: 2026-10-04. Source candidate: local `codex/modal-payment-polish`, based on main
`70c97d2`; .46 implementation candidate, no release or consumer adoption implied.

Every Core modal backdrop now uses `DialogBackdrop`, a presentation-preserving body portal.
`DialogSurface` retains its public section/div rendering and dismissal behavior while owning
background inert isolation, keyboard containment and reference-counted root/body scroll locking.
Closing the last modal restores the document position and original inline style priorities.
Long surfaces scroll internally; progress dialogs still do not interpret Escape as cancellation.
Legacy Cast inspectors now return explicit focus after unmount and use a surface ref for
portal-local scroll reset.

## Executed checks

- `npm --prefix frontend test -- --run`: 366 tests passed on the final candidate.
- `npm --prefix frontend run build`: passed. Existing large-chunk warning remains.
- `npm --prefix frontend run storybook:check`: passed.
- `npm --prefix frontend run lint`: zero errors; existing LanguagePicker fast-refresh warning remains.
- `git diff --check`: passed.
- `node frontend/scripts/verify-host-consumer.mjs`: passed against the exact packed public source.
  The sandbox initially blocked localhost binding; an approved escalated run executed the probe.
  Host TypeScript compatibility, ordinary equal-specificity CSS overrides and handled/delegated/declined
  action-required behavior passed in development and production builds.

The final public-consumer probe covers ten modal cases: six standalone viewport/theme cases and
four actual public App-to-host funding handoffs across development and production builds.

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

## Cross-entry lifecycle handoff repair

The actual hosted funding handoff subsequently exposed a defect that the single-entry modal
probe did not cover: independently optimized App and `/ui` bundles each held their own modal
registries. Mounting hosted funding while Core progress closed let Core cleanup restore scroll
styles under the still-open funding modal; competing focus/isolation managers could leave
Chromium focus on the body. Independent combined-flow reproduction found the defect in four
Chromium/WebKit cases at 390px and 1440px.

The registry now belongs to the document under
`Symbol.for("meowdiobooks.modal-lifecycle.v1")`. Both entries share the surface set, original inert
state, background observer and token-based scroll-lock ownership. A new component regression
re-evaluates the modal entry and its internal modules while the first entry remains mounted, then
mounts hosted funding and unmounts Core progress. The remaining funding modal retains focus,
non-inert ancestors, fixed-body scrolling and hidden root overflow. The focused modal suite passed
13 cases and the production build passed after this repair. The public packed-consumer probe was then extended to render the real public App and a separately
imported `/ui` host dialog together. A running Core job settles with `action_required`, removing
Core progress while opening hosted funding. All four Chromium cases passed at 1440 × 900 and
390 × 844 in development and production builds against the .46 source candidate:

| Transition | Observed result in all four cases |
| --- | --- |
| Core progress open | body `position: fixed`, root `overflow: hidden` |
| Hosted funding after Core unmount | same locks retained; focus inside funding; no inert ancestor |
| Tab in funding | focus stays on the funding action |
| Final Escape | both locks restored; focus returns to the supplied Host account action |

All cases had zero page errors. The six preceding standalone viewport/theme cases, strict external
consumer TypeScript, equal-specificity CSS overrides and handled/delegated/declined action-required
cases also passed on this candidate. Core production build, lint (zero errors with the existing
LanguagePicker warning) and Storybook typing passed after merging current main.

The independent actual Cloud 402 fixture separately observed the repaired handoff in Chromium
and WebKit at 390px and 1440px: focus inside Billing, fixed body, hidden root overflow, inert
application and no document movement under outside wheel input. That fixture also covers host
remount behavior; returning to a disconnected opener is a separate host focus contract.

The Linux packed-consumer gate additionally exposed a classic-scrollbar gutter that overlay-scrollbar
macOS runs did not reveal. Hidden overflow alone retained the shell's stable gutter. The first modal
lock now temporarily sets root scrollbar-gutter to auto and preserves/restores its original inline
value and priority. The existing full-viewport corner assertion remains unchanged; failure diagnostics
include corner hit nodes and root/backdrop dimensions. A focused regression verifies stable!important
restoration. Routing Storybook queries now use the document body for the portaled dialog; purchased
completion expectations retain current main's ready/export copy. All64 Storybook browser cases passed.
