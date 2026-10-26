# Focused review controls

Synthetic Review fixture: one verified family with 400 repeated standalone footer occurrences,
plus three mixed AI suggestions. No book text or customer data is included.

- [Final mobile, 390 px](mobile.png)
- [Final desktop, 1440 px](desktop.png)
- [Completed mobile state](completed-mobile.png)
- [Computed-style comparison](style-audit.json): footer and existing AI controls match in default
  and selected states at both widths. Ordinary decision-card styling also matches; the existing
  desktop bulk-action layout intentionally anchors its button at the bottom of the panel.
- [Rejected intermediate mobile layout](intermediate-mobile.png): the duplicated group and
  individual explanations were removed in favor of normal case-by-case choices and the existing
  warning-icon AI bulk action. This is an intermediate prototype, not a screenshot of a released UI.

Actual Chrome interaction checks at both sizes selected an individual Keep exception in each queue
item, applied the remaining suggestions, and verified all 403 decisions resolved with both exceptions
preserved. Exact singleton decision serialization and no horizontal overflow were checked. Footer
families remain separate queue items; their bulk action is scoped to that family.

Automated coverage lives in `frontend/src/reviewPatternDecisions.test.ts` and
`frontend/src/App.test.tsx`. Run `npm --prefix frontend test -- --run`,
`npm --prefix frontend run build`, and `npm --prefix frontend run lint`.
