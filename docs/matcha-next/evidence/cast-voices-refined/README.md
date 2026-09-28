# Cast Voices refinement: rendered evidence

Captured from the real Studio entry point with synthetic data on 2026-09-28. The repeatable check is `cd frontend && node scripts/verify-voice-refinement.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-voices-refined`.

For each 1440px desktop and 390px phone in light and dark appearance, `auditions-*.png` shows the centered/full-screen inspector and audition Play/Stop controls; `new-voice-*.png` shows the renamed creation view and source choices; `required-*.png` shows the missing-audition fixture with Alice marked as requiring review. `new-voice-bottom-390-*.png` records the form controls and primary generation action at the bottom of the phone inspector.

`report.json` records zero scoped axe violations in the audition and new-voice inspectors, zero page errors, native dialogs, API requests, or horizontal overflow in all four views. This verifies the synthetic UI and interactions only; it does not verify real voice generation, audio quality, or backend persistence.
