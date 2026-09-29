# Shared appearance component review

Ran the existing `frontend/scripts/review-design.mjs` against the local Storybook on port 6006 in light/dark at 1440 × 1000 and 390 × 844. Used the focused filter `^(components-(studio-primitives|dialogue-routing|workflow-compositions)|foundations-presentation-contract)--`. Refreshed both matrices after the parent corrected legacy palette assertions.

- 17 stories × four appearance/viewport combinations = 68 renders: zero axe violations, runtime/HTTP/image errors, or page overflow. Details and screenshots in `light/report.json` and `dark/report.json`.
- Separately opened configured and credential-unavailable routing dialogs and inspected isolated palette plus appearance siblings in all four combinations: 16 explicit states, zero axe violations, runtime errors, or overflow. Data and computed palette values in `dialog-siblings.json`.
- Focused Storybook interaction assertions passed: four files, 17 tests (`Components`, `WorkflowCompositions`, `Presentation`, `Routing`). This is separate from screenshot render checks, which do not guarantee story play completion.
- Source-editable controls remain available: ButtonPlayground exposes label, variant, compact, busy, and disabled props; PanelPlayground exposes title, eyebrow, variant, and content; introduction/empty compositions expose title, copy, eyebrow/symbol. `PresentationRoot` palette props remain visual values only and the component/context implementation was unchanged in this task.
- Actual sibling isolation remained intact: canonical light action is RGB(164,47,77); independent palette action RGB(35,85,72); host override RGB(47,64,110). Proposal surface remains its separate #f0ecd8 override. Explicit appearance siblings retain individual native light/dark color schemes.

## Visual issue found and resolved

The `AppearanceSiblings` phone story puts the action, status tags, error note, and native audio inline without layout spacing. At 390px the error note's inline box wraps around adjacent tags, creating overlapping-looking bordered fragments. This does not trigger axe or page overflow but makes the component comparison harder to inspect. See `appearance-siblings-390-dark.png`, which displays both light and dark siblings. The parent fixed this preview-only issue with wrapped flex spacing and a separate error paragraph. Independent focused recheck of all four appearance/viewport combinations passed axe, runtime, image, and overflow checks; visual inspection confirmed separated tags, readable multiline error text, and clean native audio placement. Final captures and reports are in `siblings-after/light/` and `siblings-after/dark/`. The earlier captures retain before-fix evidence. No unresolved issue remains.

## Limits

Synthetic stories do not validate real providers, PDF import, production audio generation, or user preference. Disabled remote route content is intentionally faded; a readable unavailable-credential explanation remains outside the disabled content. Routing dialog viewport screenshots preserve actual phone scrolling; remote benefit/trade-off content continues below the first viewport.

Storybook remains available at http://127.0.0.1:6006/ (agent-started session 54285). No app files changed or commits made by this reviewer.
