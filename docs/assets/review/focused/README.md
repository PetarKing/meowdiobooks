# Focused review controls

Synthetic Review fixture: one verified family with 400 repeated standalone footer occurrences,
plus three mixed AI suggestions. No book text or customer data is included.

- [Final mobile, 390 px](mobile.png)
- [Final desktop, 1440 px](desktop.png)
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
