> **Historical, rejected candidate.** The user rejected Nocturne on 26 September 2026. These checks do not establish design acceptance. Current work and evidence are in [Folio](../folio/README.md).

# Nocturne studio candidate

This branch starts at the neutral foundation `a9b7922`, with no Atelier art-direction commits imported. It is a local design candidate, separate from merge, release and production adoption.

The prior interface made complex work feel dense through small labels, repeated surface boxes and cramped cast tiles. A cosmetic palette swap would have preserved that friction. Nocturne uses a cinematic literary entrance and a restrained working canvas: lavender chalk, aubergine ink, violet actions, readable source evidence, and one clear next decision. The entrance carries the spectacle; review and acceptance remain operationally explicit.

## Local review

From the repository root:

```sh
npm --prefix frontend run storybook
npm --prefix frontend run studio
```

Open `http://127.0.0.1:5179/studio.html` for manual exploration, or Storybook at `http://127.0.0.1:6006/` to edit components and jump between product states. When using another Storybook port, set `VITE_STORYBOOK_URL` for the studio command. The running handoff uses Storybook port6018.

The standalone review entry uses in-memory synthetic gateways, no API proxy, and keeps its entry URL through navigation and refresh. It provides a state selector with loading, recovery, dense cast and inspector scenarios. `index.html` remains the real local workflow application.

## Foundation and contracts

Production pages and Storybook use the same source. Shared controls, workflow introductions, launch/empty compositions and collection controls have isolated stories. The stylesheet ownership map is in `frontend/src/styles/README.md`; old public CSS exports remain valid, and ordinary equal-specificity host overrides continue to win.

Native tabs and shared dialogs own their keyboard lifecycle. A nested Generate wrapper previously remounted the page on filter changes, dropping keyboard focus; the imported page now mounts stably. Progress dialogs now share the same focus trap and reference-counted scroll lock instead of duplicating presentation effects in the workflow state model. Voice inspectors cover the entire viewport, including the closing transition, so background navigation cannot discard in-progress audition edits. Large ensemble search changes visibility only; full-cast required counts and acceptance gates remain unchanged.

The 31-key edition contract, commands, gateway media fallbacks, exact candidate acceptance and backend-authoritative status remain intact. Export now names selected chapters instead of relying on decorative numbers. Dialogue's advanced editors remain available behind the rules disclosure.

## Visual source and evidence

- `ART.md` records the generated master, final prompt, runtime asset and motion lifecycle.
- `frontend/DESIGN_SYSTEM.md` records tokens, motion, responsive behavior and source ownership.
- `frontend/design-review.md` inventories every component and screen, independent observations and executed checks.
- `frontend/design-review-pages.md` details screen-specific changes and evidence.
- Key renders: [Home](screenshots/home-desktop.png), [Cast voices](screenshots/cast-voices-desktop.png), [Review](screenshots/review-desktop.png), [Library](screenshots/library-desktop.png), and [phone Cast voices](screenshots/cast-voices-phone.png).
- Executed browser reports are preserved in `evidence/`; the review ledger records their scope and limitations.

Passing checks establish specific behavior and rendered accessibility. They do not establish an aesthetic grade, live provider output, real-book persistence, or production acceptance. The existing shared JavaScript is still substantial; Three.js is lazy-loaded for the home art, with static fallback, and the inherited public CSS remains a documented migration boundary. Global instructions, skills and memories were not modified. The task-local design guide's earlier ban on ambient motion was updated to match the user's explicit request, with reduced-motion and resource limits.
