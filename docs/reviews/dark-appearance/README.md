# Shared forest appearance

The approved Darker forest palette uses a slightly deeper final canvas, `#293f33`,
with paper `#263d30`, soft surfaces `#344c3d`, and readable cherry actions `#f7abc2`.
These are shared production tokens, not workflow-only overrides. Home retains its
existing matcha atmosphere over the same base. Workflow content receives a faint,
static 7% matcha radial wash to avoid a flat fill. It does not animate or add a
stacking layer. The existing canopy animation still respects reduced motion.

Light colors are unchanged. Custom semantic palettes receive no decorative wash.
The standalone agent guide's browser background matches the shared canvas.
Workflow decisions and acceptance are unchanged.

## Visual check

Synthetic production Storybook scenes, with no palette overrides:

- [Home with its existing glow](home.jpg)
- [Workflow with the subtler glow](workflow.jpg)
- Previous blue-green baseline: [sidebar evidence before this palette change](../workflow-sidebar/README.md).

`Product/Dark appearance/Home` and `Darker forest` are interactive references.
The selected preview URL remains `product-dark-palette-options--darker-forest`.

## Verification

macOS arm64, Node 22.23.4, locked dependencies and native Chromium. No CI VM started.

```sh
npm --prefix frontend test
npm --prefix frontend run storybook:check
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test-storybook -- stories/DarkPalette.stories.tsx stories/WorkflowSidebar.stories.tsx stories/MobileReviewNavigation.stories.tsx stories/CompactReviewPassages.stories.tsx stories/CleanupReview.stories.tsx stories/AliceReviewPassages.stories.tsx stories/ScriptDirections.stories.tsx
node frontend/scripts/verify-appearance.mjs /tmp/darker-forest-final/contrast.json
node frontend/scripts/verify-workflow-sidebar.mjs http://127.0.0.1:6017 /tmp/darker-forest-final/sidebar
node frontend/scripts/verify-mobile-review.mjs http://127.0.0.1:6017 '' /tmp/darker-forest-final/review
```

- 598 native tests across 43 files and 26 browser stories across 7 files pass.
- Story typecheck and build pass; lint has zero errors and the existing two
  Fast Refresh warnings. The existing bundle-size advisory remains.
- [Solid-surface text/control contrast](contrast.json) passes in both appearances.
- 10 sidebar viewport/theme checks and 12 review viewport/theme checks plus
  two motion scenarios pass, including automated accessibility checks.
- Browser inspection confirms both Home and workflow resolve canvas `#293f33`
  and paper `#263d30`. Their different gradients are intentional.

The user requested coordination with the logo task. That task owns boxed M assets
and has been given the same `#293f33` background and `#f7abc2` cherry tokens;
unboxed marks should inherit the surface. This change does not import, release,
or deploy that separate branding work.
