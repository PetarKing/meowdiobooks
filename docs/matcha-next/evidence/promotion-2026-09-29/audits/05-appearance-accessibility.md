# Audit 05 — Appearance and accessibility

Date: 2026-09-29. Integrated source: `68fcf318be7d7f49c396d135663cbfaa8e24438d`.
Reviewer: independent appearance/accessibility agent. Browser actions used CUA only, in a separate
background tab. Fixtures were synthetic; no providers or production data were used.

## Result

No blocking appearance/accessibility defect was reproduced in this scoped audit. The semantic
light/dark pairs tested exceed 4.5:1, host colors retain precedence, portal appearance/focus contracts
hold, and phone status and inspector content remained usable. The broader Storybook/CI accessibility
matrix remains a required promotion gate; this audit does not claim every decorated pixel or every
workflow state passed a full contrast audit.

One documentation defect was repaired with coordinator authorization:
[`docs/folio/APPEARANCE.md`](../../../../../docs/folio/APPEARANCE.md) described the former native
Light/Dark/System select. It now describes the existing single icon toggle, implicit System default,
explicit local preference persistence, and the separate controlled host contract supporting System.
Historical Folio evidence is identified as historical rather than presented as current-header proof.

## Executed evidence

### Focused tests

```sh
npm --prefix frontend test -- --run src/app/useAppearance.test.tsx src/components/ThemeToggle.test.tsx src/components/PresentationRoot.test.tsx src/components/PhaseHelp.test.tsx src/components/DialogSurface.test.tsx src/components/Ui.test.tsx
```

Result: **6 files, 29 tests passed**. See [unit-tests.txt](05-appearance-assets/unit-tests.txt).
Coverage includes blocked/malformed storage, live system changes, controlled host authority without
local persistence, accessible toggle state, sibling palette isolation, nesting rejection, dark/custom
portal tokens without copied geometry, focus trapping/restoration, safe initial confirmation focus,
topmost nested-modal Escape handling, scroll locking and disabled progress dismissal.

### Current rendered palette and contrast

Used canonical Storybook iframe IDs from the current `index.json`, without `legacyMedia`:

- `foundations-presentation-contract--appearance-siblings`
- `foundations-presentation-contract--isolated-palette`
- `product-accepted-baseline--cast-voice-review-states`

The appearance siblings simultaneously rendered distinct light/dark `color-scheme` values. Computed
colors were read through CUA, then WCAG sRGB luminance ratios were calculated from the solid rendered
foreground/background values. `color(srgb …)` mixed backgrounds were included directly.

| Pair | Light ratio | Dark ratio |
| --- | ---: | ---: |
| Body copy on paper | 12.25 | 10.62 |
| Primary action label | 6.79 | 7.61 |
| Success / Accepted | 5.62 | 5.94 |
| Attention / Review needed | 5.77 | 5.80 |
| Error message | 5.60 | 5.01 |

Evidence: [measured-contrast.json](05-appearance-assets/measured-contrast.json),
[raw computed styles](05-appearance-assets/appearance-siblings-colors.json),
[appearance screenshot](05-appearance-assets/appearance-siblings-desktop.jpg).

Host/palette rendering showed canonical action `rgb(164, 47, 77)`, supplied semantic action
`rgb(35, 85, 72)`, and later ordinary host CSS action `rgb(47, 64, 110)`. Supplied paper rendered
`rgb(240, 236, 216)`. Font, 6px radius, 12px/20px padding and approximately 44px height remained equal
across sibling buttons. See [isolated-palette.json](05-appearance-assets/isolated-palette.json) and
[screenshot](05-appearance-assets/isolated-palette-desktop.jpg).

The live Storybook accessibility addon on canonical dark Voices reported **0 violations, 26 passes,
2 inconclusive rule groups**. The inconclusive groups were `aria-prohibited-attr` (1 element) and
`color-contrast` (36 elements), so zero violations alone does not establish contrast on every
decorated surface. See [addon screenshot](05-appearance-assets/voices-dark-axe-manager.jpg).

### Portals, keyboard focus and phone readability

- Light Phase Help rendered as a body portal with the originating `data-appearance="light"` and
  native `color-scheme: light`; body scrolling locked. Initial focus entered **Close phase guide**,
  Tab stayed contained, and Escape returned focus to **About Extract** and restored body overflow.
  [Portal readback](05-appearance-assets/phase-help-light-portal.json).
- Phase Help at measured **433×938 CSS pixels** fit its text and close control on screen.
  [Geometry](05-appearance-assets/phase-help-phone-geometry.json),
  [screenshot](05-appearance-assets/phase-help-phone-light.jpg). Its `scrollWidth` exceeded
  `clientWidth` because the decorative `.phase-help::before` extends beyond the surface; the surface
  explicitly clips that pseudo-element and no text/document overflow was observed.
- Voices at measured **320×844 CSS pixels** had zero document horizontal overflow. Required and
  optional states retained readable visible labels and distinct accessible descriptions. Progress
  and status copy measured 11px; names wrapped. These are compact labels, not evidence of a larger
  default text setting. [Geometry/styles](05-appearance-assets/voices-minimum-light.json),
  [screenshot](05-appearance-assets/voices-minimum-light.jpg).
- The settled required **Alice voice** inspector at measured **390×844 CSS pixels** filled the screen
  with zero document or dialog horizontal overflow. Tab moved from the dialog to the close control,
  whose cherry outline was visible. Escape closed the inspector and restored focus to **Open Alice
  voice**. [Geometry](05-appearance-assets/voice-inspector-390-light.json),
  [screenshot](05-appearance-assets/voice-inspector-390-light.jpg),
  [return-focus readback](05-appearance-assets/voice-inspector-focus-return.json).

An initial inspector click during a still-settling fixture did not leave an inspector mounted. That
attempt was discarded; the settled fixture was rechecked and only the verified 390px inspector is
reported as evidence. The temporary viewport override was reset and the audit tab was closed.

## Source review and practical limits

- `appearance.css` scopes defaults to presentation roots and preserves inline semantic host tokens.
  Status colors are separate from decorative temple colors. A host choosing a different action
  color remains responsible for its corresponding `--action-ink`, as documented by the existing
  public contract.
- `PresentationRoot` rejects nesting. The presentation context copies appearance and custom visual
  properties to a portal, while excluding root layout geometry. Native audio/inputs use the root's
  color scheme.
- `primitives.css` loads after baseline CSS and supplies visible focus outlines for buttons, inputs,
  selects, textareas and summaries. The inspected inspector close button retained its visible ring.
- Required/optional states include text, accessible descriptions and blocked-control semantics;
  color is supplemental. Reduced-motion CSS disables sanctuary, roster and audition animation.
- Source uses local system font stacks (Avenir/Segoe/system sans; Iowan/Baskerville/Times serif).
  Actual macOS rendering was inspected. Other-platform fallback typography was not rendered here.
- Canonical product stories have **no legacy contrast exemptions**: `Product.stories.tsx` line 11
  populates exceptions only when the URL explicitly contains `legacyMedia`; ordinary stories use
  an empty list and selector `*`. The global a11y test mode is `error`.
- Full automated Storybook/axe execution, every gradient/art background, actual 200% browser zoom,
  text-only enlargement, and live OS preference transitions were not independently executed in this
  audit. Hook tests cover System transitions; the current browser checks cover solid semantic pairs,
  phone reflow and focus. The promotion owner is running broader mandatory gates.

## Reproduction and startup blocker

The sandboxed Storybook launch initially failed with `NoFreePortError` because localhost binding was
blocked. The same authorized server command with sandbox escalation succeeded:

```sh
npm --prefix frontend run storybook -- --port 6006
```

Server session `27717` was left running for the coordinator's remaining reviews. Open the exact
iframe IDs above at `http://127.0.0.1:6006/iframe.html?id=<id>&viewMode=story`; append
`&appearance=dark` for deterministic dark product stories. The standalone Studio at
`http://127.0.0.1:5181/studio.html?appearance=light` uses the visible **Preview** selector to enter
fixtures; the scenario URL parameter does not select a fixture. IAB physical/CSS sizing differed by
its existing scale: 288 physical measured 320 CSS, and 351 physical measured 390 CSS. Reported sizes
are DOM readbacks, not assumed viewport values.
