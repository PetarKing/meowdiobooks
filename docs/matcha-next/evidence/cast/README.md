# Cast redesign — first roster pass

The arched roster images here document the earlier iteration. The [square-panel correction](../cast-flat/README.md) is the current visual candidate following user review; audition and dialog behavior remains as documented below.

The voice roster is a portrait grid (five columns at 1440 px; two at 390 px). The centered audition inspector shows preserved candidate revisions and a **New voice** card. Clicking a candidate selects its exact revision immediately; New voice swaps to design, sample clone, and reuse controls, with a return link. A single Play/Stop control is independent of selection. Accepted Cast “Change settings” automatically prepares an editable candidate and opens Voices after the designed confirmation; Edit cast remains available. A saved draft reopens directly. The three former native Cast confirmations use the shared accessible dialog surface.

Run from `frontend/` with the local synthetic preview server:

```sh
node scripts/review-cast-stage.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast
```

[report.json](report.json) records four desktop/phone and light/dark browser runs: exact candidate selection, New voice mode, confirmation cancel/continue, Escape/cancel focus return, direct Voices return, no document overflow, browser errors, native dialogs or `/api/` requests, and no scoped axe violations for roster, inspector, New voice and confirmation. [Desktop roster](roster-1440-light.png), [phone roster](roster-390-dark.png), [audition inspector](auditions-1440-light.png), [New voice editor on phone](ghost-390-dark.png), and [designed confirmation](confirmation-1440-light.png) are representative captures. All sixteen screenshots are retained for comparison.

The synthetic fixture validates presentation and frontend state flow. It does not perform real voice synthesis or accept a persisted backend Cast revision. App tests cover the exact revision passed through the acceptance contract, missing audition, saved draft, cancellation, and regeneration confirmation.
