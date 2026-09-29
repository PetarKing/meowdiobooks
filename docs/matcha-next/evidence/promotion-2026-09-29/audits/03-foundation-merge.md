# Foundation integration audit — 2026-09-29

Reviewer: independent auditor 03. Scope: the eleven assigned foundation conflict paths. No implementation files, index entries, branches, or external systems were changed by this audit.

## Decision

Reconcile these paths around the studio implementation at `9545014c8100f1e286baddc7a935c99145bffa8b`, preserving the explicit main invariants below. Inspection found no main-only functional implementation or unit-test coverage in these paths that studio drops. The old coral baseline is intentionally superseded by the approved canonical studio palette; its color literals should not be restored.

One repair is required: the `AppearanceSiblings` story's two dark action assertions are stale relative to studio's final CSS. This report does not authorize resolving other conflicts wholesale or establish that the final merged package passes browser validation.

Compared exact main `590bcd44016dd7236a57d6612160a9bdccb73e46` with exact studio `9545014c8100f1e286baddc7a935c99145bffa8b`. Their merge base is `d3855c3bb921d654aae02bb28fa3858a7e01b86c`. Main's only subsequent commit touching this group is `590bcd4`, “Adopt a neutral design-system foundation with visual parity guards (#78)”. The eleven-path comparison is 98 insertions and 20 deletions; this bounded comparison is the basis for the recommendations, rather than an assumption that studio may replace everything on main.

## Per-file reconciliation

| Conflict path | Main contribution and actual difference | Recommendation |
| --- | --- | --- |
| `frontend/src/components/PresentationRoot.tsx` | Main introduced eight optional semantic palette fields, palette-to-custom-property mapping, native div attributes, inline style precedence, and a context guard rejecting nested roots. Studio retains all of these, adds optional explicit light/dark appearance, and moves context to `presentationContext.ts` so body portals can carry only visual tokens. | Keep studio. Preserve all eight palette fields and mapping, `style` precedence over palette-generated properties, sibling isolation, and the nesting error. Include the new context module in the package. |
| `frontend/src/components/PresentationRoot.test.tsx` | Both of main's tests remain unchanged in purpose: sibling palette isolation and rejection of nested roots. Studio adds palette-marker assertions and an appearance-isolation test. | Keep studio's superset. No main test is removed. |
| `frontend/src/components/Ui.tsx` | Main's `InspectorDialog` and `Choice` implementations are identical in studio. Studio expands button variants with `secondary`/`danger`, adds a busy state while retaining the action label, and expands `Panel`/`Tag` to forward native attributes and classes. Original variants, default `type="button"`, refs, native disabled/submit behavior, the existing panel title/eyebrow/actions API, and tag tones remain supported. | Keep studio. Preserve unchanged inspector and choice lifecycles, the original variants, and native props/ref behavior. The new APIs are additive. |
| `frontend/src/components/Ui.test.tsx` | All eight main tests remain. Studio adds busy-action recovery/duplicate prevention and native panel/status semantics tests. Main's dialog focus, rerender callback, backdrop/animation, and selection/help cases remain present. | Keep studio's ten tests. Do not shorten the existing dialog or choice cases. |
| `frontend/src/components/SourceExcerpt.tsx` | Source/context rendering is identical; studio appends the stable `source-excerpt` class while retaining caller classes. Source is still rendered as React text, with no HTML interpretation or invented context. | Keep studio. Retain the same literal-source and missing-context contracts. Existing `SourceExcerpt.test.tsx` is identical across revisions and passes on both. |
| `frontend/src/ui.ts` | Every main value and type export is retained. Studio adds `PanelProps`, `TagProps`, workflow compositions, collection toolbar, theme toggle, and appearance hook/types. | Keep studio's export superset. Retain the public `./ui` package entry and ensure all added imported modules are included in the packed source allowlist. |
| `frontend/src/app/contracts.ts` | All main composition props and context/capability types are unchanged. Studio adds only optional `appearance` and `onAppearanceChange`. | Keep studio. Host header, library actions, step overrides, gateway, journey, three capability flags, and generation estimate policy remain the typed extension seam. Appearance must stay UI-only. |
| `frontend/scripts/verify-host-consumer.mjs` | Entire main harness is retained except the canonical baseline color assertion changes from coral `rgb(237, 102, 89)` to studio cherry `rgb(164, 47, 77)`. Package exclusions, fixed host translation/prop compilation, standalone and App-header consumers, ordinary host background/radius override, equal-specificity hover override, page-error collection, and cleanup remain unchanged. | Keep studio's new baseline literal and all other assertions. Do not weaken the normal/hover host override checks to make adoption pass. Browser execution remains required after reconciliation. |
| `frontend/.storybook/preview.ts` | Main's canonical CSS import, failing accessibility mode, sorting, locale/storage reset/restore, and protection of the iframe URL are unchanged. Studio adds only frame-only `preview.css`. | Keep studio. Preserve `a11y.test = "error"`, restoration callbacks, and product CSS loaded before preview styling. |
| `frontend/stories/Presentation.stories.tsx` | Main's sibling palette/ordinary host rule assertions, palette-only geometry equality checks, and single-root product story remain. Studio replaces coral baseline/name, removes the historical coral contrast exception, and adds light/dark sibling coverage. | Keep studio's stories but repair the two stale dark assertions described below, then execute the story against the rendered final CSS. Retain host override, geometry, and one-root checks. |
| `frontend/stories/baselineContrastExceptions.ts` | Studio removes only the old inspector audition-label selector from main's historical debt list. The remaining historical list is intact. Supporting `Product.stories.tsx` now enables these exceptions only when `?legacyMedia` is explicitly present; canonical studio stories use selector `*`. | Keep studio's narrower list. Preserve the `legacyMedia` restriction in the separately owned Product stories conflict; do not allow this historical list to suppress canonical studio contrast failures. |

## Required story repair

At exact studio, `AppearanceSiblings` asserts:

- Dark primary background: `rgb(243, 142, 173)`.
- Dark primary foreground: `rgb(20, 35, 31)`.

But `src/styles/appearance.css` defines dark `--folio-action: #f49bb6` (`rgb(244, 155, 182)`) and `--action-ink: #15262a` (`rgb(21, 38, 42)`). `primitives.css` supplies `.primary` background through `--color-action`/`--poppy` and foreground through `--action-ink`; this story supplies no custom palette. A bounded search of the imported studio styles found no later primary-color or token assignment overriding those values for this plain Panel/Button composition. These two literals therefore require reconciliation with the accepted rendered palette. This is source-derived evidence; no browser measurement was performed by this auditor.

## Main invariants that must survive the merged result

1. **Semantic palette and scope:** `action`, `actionHover`, `ink`, `muted`, `paper`, `border`, `success`, and `warning` remain optional. Palette affects presentation rather than workflow commands/state. Custom root values remain local, including dark roots and body portals. Nested roots are rejected; complete art directions use separate frames.
2. **Ordinary host CSS priority:** public `product.css` remains unlayered and explicitly imported by the host once before host styles. Standalone `Button` and `App` header consumers must both accept equal-specificity `.primary` background/radius and `.primary:hover:not(:disabled)` overrides. Preserve the consumer harness's exact override checks and packaged development-file exclusions.
3. **Public API continuity:** retain every export from main's `ui.ts` and every existing `AppProps`/context/capability field. No private credentials, provider policy, account ownership, billing identifiers, or workflow artifact changes belong in these foundation seams.
4. **Edition copy:** the fixed accepted-main host bundle and all 31 edition keys remain supported in English and Simplified Chinese. Edition overrides change only their namespace and do not disguise capabilities or replace ordinary workflow translations.
5. **Dialog lifecycle:** focus enters the modal, stays in the topmost modal, survives rerenders, returns to its trigger, and restores prior scroll state. Escape uses the latest dismissal callback and must not become cancellation for a progress dialog with no dismiss handler. Sibling scroll locks and nested Escape ownership remain supported.
6. **Literal source evidence and native controls:** excerpt markup stays literal text; absent context remains absent. Button submit/disabled/ref behavior and choice selection/help separation survive the new presentation APIs.
7. **Verification strength:** retain main's tests and host-consumer checks. Canonical stories continue to fail accessibility errors without historical contrast exemptions; historical parity alone does not verify final studio behavior.

## Exact supporting identity evidence

The following supporting files are byte-identical at main and studio. They were inspected to test compatibility claims, not assigned for conflict resolution:

| File | Shared Git blob |
| --- | --- |
| `frontend/src/components/DialogSurface.tsx` | `1b2827a1deebda6e02c2ffffe07850c034adc8d6` |
| `frontend/src/components/useDialogFocus.ts` | `30fc7db4a95b796b91db410e47066872ed85fc44` |
| `frontend/src/test/hostCompatibility.tsx` | `fcadd328968e910f3997fadb0e2e88834a29486b` |
| `frontend/src/locales/edition.ts` | `003d7fa8b9ee932fad9365a89bff023892668638` |
| `frontend/src/i18n.ts` | `172fb0fd35c4deac36031fb80fea5471f85b9c24` |

The edition key list was counted directly in both exact blobs: 31 on main, 31 on studio. The inspector and choice implementations also have no diff within `Ui.tsx`. Unit-test-name comparison found zero removed tests in PresentationRoot, Ui, DialogSurface, or SourceExcerpt.

## Executed validation

Created two disposable exact-source snapshots with `git archive <revision> frontend` under `/private/tmp/meowdiobooks-foundation-merge03-lo5_kyoy`. Each snapshot's `frontend/node_modules` points to the existing installed dependency tree. No installation or network operation was performed. The source under test came from the exact revisions rather than conflicted working files. Installed Vitest version: `4.1.11`.

Ran from each snapshot's `frontend` directory:

```sh
npm test -- --run src/components/PresentationRoot.test.tsx src/components/Ui.test.tsx src/components/DialogSurface.test.tsx src/components/PhaseHelp.test.tsx
npm test -- --run src/components/SourceExcerpt.test.tsx src/components/TabList.test.tsx src/i18n.test.tsx src/app/useAppearance.test.tsx
```

| Revision | Modal/presentation suite | Source/tab/localization/appearance suite | Total distinct executed tests |
| --- | --- | --- | --- |
| Main `590bcd4` | 3 files, 18 passed | 3 files, 9 passed | 27 passed |
| Studio `9545014` | 4 files, 23 passed | 4 files, 13 passed | 36 passed |

Main has no PhaseHelp or appearance-hook test file; the pattern matched the other requested files. Studio's added PhaseHelp tests verify that the body portal retains dark appearance plus custom semantic/raw visual tokens while excluding layout width, and that its shared dialog focuses close, traps Tab, restores the trigger on Escape, and restores scrolling. Appearance tests include malformed/blocked storage, host-controlled authority without local writes, and system preference/listener cleanup. Excerpt tests include literal script-like input and missing context; localization tests include edition-only overrides for both supported locales.

Not executed here: rendered Storybook plays, packaged host browser exercise, full frontend suite/build/lint, merged-source verification, or Cloud adoption. In particular, source comparison supports preservation of host override logic; it does not establish the final cascade result. The parent must execute the repaired story and host consumer checks after resolving the complete merge. Provider/private ownership commits outside this group remain the parent's separately scoped audit responsibility.
