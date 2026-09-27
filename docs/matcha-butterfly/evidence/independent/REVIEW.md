# Independent rendered review

The reported AI-assisted badge collision, duplicate checkbox focus and nested Dialogue framing are resolved in the inspected live UI. No remaining overlap was observed in the reviewed screenshots.

The matrix covers accepted Dialogue, Extract, Dialogue setup, empty Library, Generate with 120 chapters and Export with 20 chapters, at 1440, 900 and 390 pixels, in light and dark modes. All 36 cases measured zero document horizontal overflow and zero axe violations within the presentation root. These are live production components using synthetic studio fixtures; this does not verify backend extraction, generation or export delivery.

The final Dialogue recheck recaptured all six size/mode cases after the framing correction. Attribution scopes, narrator outcome and both Example disclosures have computed zero borders and transparent backgrounds. The outer strategy grouping remains visible. Keyboard focus appears once on the native scope checkbox; its label has no focus outline.

Accepted AI annotations stay within their stat column at all three widths. Generate title clicks change chapter selection; Listen preserves selection and native audio inherits the selected color scheme. Extract choices have one visible focus indicator. Export title inputs use one colored underline; chapter and format choices use one label outline. The theme icon starts from the system preference, responds to keyboard Space, stores the selection and restores it after reload.

Evidence: [matrix and computed styles](report.json), [theme interaction](theme-interaction.json), [Export focus](export-focus.json). Screenshots use `{scenario}-{width}-{appearance}.png`; each matrix result records its capture timestamp.

Run with the frontend preview already serving. Full matrix (around one minute):

```sh
node docs/matcha-butterfly/evidence/independent/audit.mjs http://127.0.0.1:5179/studio.html
```

Focused Dialogue recapture and supplemental Export focus:

```sh
node docs/matcha-butterfly/evidence/independent/audit.mjs http://127.0.0.1:5179/studio.html '^dialogue$'
node docs/matcha-butterfly/evidence/independent/export-focus.mjs http://127.0.0.1:5179/studio.html
```

Focused runs merge their results into the existing matrix rather than discarding previous evidence. Chromium must be allowed to launch in the execution environment. No application source was edited by this review.
