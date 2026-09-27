# Open edition workbench verification

The Export page now gives the edition a large, live cover proof with editable bibliographic details alongside it. Chapter contents and format choices occupy open, generous sections rather than nested framed cards. The same native inputs, accepted current-audio selection, cover source, metadata, file-size estimation and export command are preserved.

## Executed evidence

- `npm --prefix frontend test -- --run src/App.test.tsx`: 110 tests passed, including the existing Export request contract (selected accepted audio revision, metadata, source page and chosen preset) and backward-navigation availability.
- `npx --prefix frontend tsc -b frontend/tsconfig.json`: passed.
- `node docs/matcha-butterfly/evidence/export/verify.mjs`: passed at 1440 and 390 pixels in light and dark. See `report.json` and the screenshots in this folder.
- All four browser states exercised the 20-chapter fixture, chapter selection by clicking its visible title, Clear/Select all, the empty-selection and empty-title gates, all three output formats, long mixed-script metadata, synthetic uploaded cover, reset to original metadata/PDF cover and PDF page selection.
- All four had zero document overflow, runtime errors or axe violations within the Export workbench.

The browser fixture uses synthetic chapter data, a synthetic source page and a synthetic one-pixel uploaded PNG. It does not encode or download an audiobook. The existing App contract test verifies the export gateway request; this design change does not modify encoding or output services.

Cover reset now immediately prefers the selected PDF source when a custom file is removed, instead of briefly continuing to display the uploaded URL until its effect cleans up. The upload preview still follows the existing asynchronous object-URL lifecycle.
