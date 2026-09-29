# Cast and Voices follow-up · 28 September 2026

This is a local, synthetic Studio review of the shared Cast/Voices roster cards and the audition flow. The fixture does not call a voice provider, save a real book, or establish production approval.

The focused comparisons are [Cast identity on desktop](identity-1440-dark.png), [Cast identity on a phone](identity-390-light.png), [Voices with required review](roster-1440-dark.png), [new audition back in the list](audition-generated-1440-dark.png), and [reclassification returned to Cast](reclassified-1440-dark.png). [Generate](generate-flat-1440-light.png) and [Export](export-flat-1440-light.png) show the flatter later-step treatment. Other light/dark and phone captures are in this directory.

`report.json` comes from `frontend/scripts/verify-cast-independent.mjs` at 1440 and 390 px in light and dark mode. It confirms a 61-member dense grid, no horizontal clipping of the long name, one-click audition application, retained settings, reclassification to Cast, keyboard focus restoration, no native dialogs, and no unexpected API requests or page errors. Separate Cast identity and Voice browser audits checked the suggested-match Attach path and reported zero scoped axe violations at both widths and themes.

Frontend validation for this revision: 256 unit tests, 58 Storybook browser tests, production build, host-consumer package/override check, and ESLint (one existing Fast Refresh warning in `LanguagePicker.tsx`; no errors). The audition-completion flow was checked with a synthetic generated candidate returning to the auditions list and focusing its Play control.
