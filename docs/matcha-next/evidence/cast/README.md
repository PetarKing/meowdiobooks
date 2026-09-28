# Cast redesign — rendered evidence

The voice roster is now a selectable portrait grid (five columns at 1440 px; two at 390 px). The compact audition inspector shows preserved candidate revisions and a Ghost card. Clicking a candidate selects its exact revision immediately; Ghost swaps to design, sample clone, and reuse controls, with a return link. Existing audio controls remain independent of selection. Accepted Cast “Change settings” opens the populated editor after a designed confirmation, and a saved draft reopens directly. The three former native Cast confirmations use the shared accessible dialog surface.

Run from `frontend/` with the local synthetic preview server:

```sh
node scripts/review-cast-stage.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast
```

[report.json](report.json) records four desktop/phone and light/dark browser runs: exact candidate selection, Ghost mode, confirmation cancel/continue, Escape/cancel focus return, no document overflow, browser errors, native dialogs or `/api/` requests, and no scoped axe violations for roster, inspector, Ghost and confirmation. [Desktop roster](roster-1440-light.png), [phone roster](roster-390-dark.png), [compact audition inspector](auditions-1440-light.png), [Ghost editor on phone](ghost-390-dark.png), and [designed confirmation](confirmation-1440-light.png) are representative captures. All sixteen screenshots are retained for comparison.

The synthetic fixture validates presentation and frontend state flow. It does not perform real voice synthesis or accept a persisted backend Cast revision. App tests cover the exact revision passed through the acceptance contract, missing audition, saved draft, cancellation, and regeneration confirmation.
