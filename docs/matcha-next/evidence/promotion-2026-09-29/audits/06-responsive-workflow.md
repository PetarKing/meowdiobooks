# Audit 06 — responsive workflow and recovery

**Result: no blocking finding in the tested scope.** Rendered Library actions, shared Cast/Voices card design, settings dismissal, Extract choice stability, and Export cover/dock/format geometry behaved correctly. This is frontend fixture evidence, not proof of real provider, filesystem opener, or encoded export behavior.

Current checkout at completion: `90d6ff1c95d2f9b13c54aa682d85da36a2aae8e9`. Tested the integrated studio at `http://localhost:5181/studio.html`, changing scenarios through its Preview combobox. Audit began on the parent task's `4c80384` state and continued during the parent’s backend/CI/doc repairs; parent confirmed no UI change from `68fcf318` to final HEAD. No implementation or Git mutation was performed by this audit.

## Executed and observed

| Check | Evidence and result |
| --- | --- |
| Shared Cast/Voices design, 390×844 | Both use two 174 px columns, the same curved portrait field and copy composition. Required/optional indicators remain visible. Dense identity and voice rosters both have 0 px document overflow. Different copy causes expected row heights: identities first row 191.99 px; voices first row 200.19 px. |
| Keyboard inspection vs preview playback, desktop | Enter on **Open Narrator voice** opens a dialog and focuses its section. Escape closes it and restores focus to the originating card. Space on **Play Narrator preview** changes it to **Stop Narrator preview**, `aria-pressed=true`, with no dialog. The sample subsequently finishes and returns to Play. |
| Cast settings dropdown, 390×844 | Summary opens by click and Enter. Clicking **Build the cast.** outside the dropdown closes it. A separate open → Escape test also closes it and leaves focus on the summary. Document overflow remains 0 px. |
| Library action placement, 320×844 and 390×844 | Cover and metadata remain side by side; actions occupy the row beneath the complete book entry. **Open audiobook** and **Show in Finder** fit without clipping or overlap, including the long selected-chapters title. Document overflow is 0 px. |
| Library action placement, 1440×900 | Two editions display in two columns. Each action pair stays beneath its metadata, beside its own cover. No overlap or document overflow. |
| Library refresh recovery, 390×844 | Refresh-failed scenario preserves both cached editions and displays **Try again**. Enter on Try again removes the error while retaining both editions. |
| Extract selection, 390×844 | LiteParse → Native PDF text → LiteParse by keyboard. All three choice shells remain 220×132 px, with document top 389.52 px. Page heading stays at document top 645.52 px and document height stays 1611 px. Browser focus scroll changes the viewport position, not layout. Recommended badge retains its space. |
| Export full-height cover, 390×844 | Frame and cover share exactly 358×473.48 px. Controls are an absolute 120 px overlay ending at the cover bottom, not an extra shelf. Navigation fits within the frame. |
| Export full-height cover, 1440×900 | Frame and cover share exactly 444.80×588.27 px. Absolute controls are 136 px high and end at the same bottom (923.31 px in the top view). |
| Export cover-page recovery | Enter on Next changes 1 → 2 and enables Previous. Entering 0 and tabbing away normalizes to page 1, with Previous disabled and source copy synchronized. |
| Export format selection, 390×844 | High-quality M4B → Smaller M4B → MP3 by Space. All format rows remain 126 px high, with unchanged document tops 1843.09 / 1969.09 / 2095.09 px. Document height remains 2490 px. Summary action and estimate reflect the selected format. |
| Export dock at document end | At phone maximum scroll 1646 px, dock top/bottom are 604.09 / 743.89 px in an 844 px viewport, leaving about 100 px of natural document tail. It does not pin itself permanently to the viewport floor or obscure the format rows. Desktop bottom view also shows the complete dock after the content. |
| Export empty-selection recovery, desktop | Enter on Clear produces **Choose at least one chapter** and disables Create MP3 ZIP. Enter on Select all restores 20 chapters, estimates, and enabled creation. No export was executed. |

## Evidence

Raw DOM geometry and selected-state measurements: [06-responsive-metrics.json](../rendered/06-responsive-metrics.json).

- [Voices, 390](../rendered/06-voices-390.jpg)
- [Cast, 390](../rendered/06-cast-390.jpg)
- [Cast settings open, 390](../rendered/06-cast-settings-390.jpg)
- [Library, 320](../rendered/06-library-320.jpg), [390](../rendered/06-library-390.jpg), [1440](../rendered/06-library-1440.jpg)
- [Library after refresh retry, 390](../rendered/06-library-refresh-390.jpg)
- [Export top, 390](../rendered/06-export-top-390.jpg), [1440](../rendered/06-export-top-1440.jpg)
- [Export dock/formats at document end, 390](../rendered/06-export-bottom-390.jpg), [1440](../rendered/06-export-bottom-1440.jpg)

All interactions used CUA in an independent background tab. Measurements came from read-only rendered DOM queries. Viewport overrides were measured as actual CSS `innerWidth`/`innerHeight`, reset, and the temporary tab closed. Screenshots are unscaled native captures. For scrolled evidence, native `getScreenshot()` was used; a clip with `y=0` targets document origin and is unsuitable as proof of the current scrolled viewport.

## Scope limits

- Parent already covered the precise phone whole-card hit area, audition append/focus transition, and 120-chapter Generate dock; this audit checked separate keyboard contracts and Export behavior instead of duplicating those actions.
- Audit 05 independently covered phone appearance/status text, focus, and accessibility. This audit did not repeat its entire appearance matrix.
- No real book import, provider generation, image upload, filesystem opening, or final export was executed. No paid provider was called.
