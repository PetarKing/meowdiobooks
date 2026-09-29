# Audit 09 — navigation, recovery, localization, motion

Result: PASS for the bounded scope below. One localization defect was found, fixed by the root agent, and independently rechecked in the rendered UI. No remaining release blocker was observed. This report does not establish deployment readiness or real-provider behavior.

Inspected source: `90d6ff1c95d2f9b13c54aa682d85da36a2aae8e9`, plus the root agent's one-line uncommitted Cast line-count localization repair. Audit date: 2026-09-29. I made no implementation or Git changes. I read repository AGENTS, contributor guidance, and architecture/public presentation boundaries.

## Executed tests

`npm --prefix frontend test -- --run src/App.test.tsx src/components/CastIdentityReview.test.tsx src/components/CastVoiceReview.test.tsx src/i18n.test.tsx`

All 4 files and 164 tests passed in 15.09 seconds. The log is `09-focused-tests.txt`. These cover automatic Review rescan and failed retry without acceptance, accepted Cast replacement failure preservation, Cancel Cast edits returning to Voices, reclassification, audition chronology and focused return, one-click exact candidate application, partially failed/canceled chapter recovery, focus restoration, Chinese labels, browser locale normalization, and generation/export selection. These are mocked gateway tests; they do not prove backend/provider publication safety.

## Independent rendered execution

All interactions used an owned CUA browser tab at `http://127.0.0.1:5181/studio.html`. No browser interaction used shell automation. The browser zoom was 90%; a physical viewport of 288×760 produced a measured CSS viewport of 320×844. Temporary viewport changes were reset and the owned tab was closed.

| Scenario | Observed result |
| --- | --- |
| Review recovery | The invalid-source-range warning states no audio changed. Rebuild Dialogue opens the previous Dialogue settings, including AI route and selected unresolved speech scope. |
| Accepted Review → Change settings | One click starts and finishes a fresh candidate, landing on populated Review with no Scan invitation or extra confirmation. The focused test separately exercises the in-progress status, delayed completion, and failure retry. |
| Chinese failed Generate | Tracks 1–3 retain Play controls; exactly 4–6 are checked for retry. The error appears beside the retry action. The fixture intentionally fails again on retry; it does not simulate successful recovery. |
| Successful Generate → Export | Standard fixture generates exactly 4–6, selects Generated 6, and leaves 1–3 unchecked. Continue to Export preserves exactly chapter 04/05/06 checkboxes. |
| Voices → Edit Cast → Cancel | Opens Cast, then returns to Voices; focus returns to the Edit Cast button. No additional confirmation is required. |
| Cast reclassify | The confirmation is localized. Confirming reclassification opens the Cast identity grid with Generate required auditions, rather than opening Voices. |
| Voice preview | The separate initials control exposes a localized Stop name and pressed state while playing. It restores Play/initials when the short fixture ends. Keyboard Enter on the inspect target opens the inspector. |
| New audition | From Narrator's three auditions, Create/Generate returns immediately to Auditions 1, 2, 3, 4 in chronological order. Focus lands on Play audition 4. Applying audition 1 with one click updates its pressed state and the approved count while keeping the inspector open. Closing returns focus to Open Narrator's voice. |
| Dialogue running loader | Localized named dialog and progressbar with value 36. Tab stays inside the processing dialog. |
| Generate running loader | Localized generation dialog and chapter progressbar with value 36, consistent progress-track treatment and no phone document overflow. |

Measured document horizontal overflow was 0 CSS px at width 320 for the Voices grid, failed Generate, successful Export, and Review return. The initial Dialogue recovery screenshot uses measured width 355 and is named accordingly; it also had zero overflow. These checks do not certify all possible chapter/title lengths.

## Defect found and rechecked

Chinese Cast tile metadata initially rendered `148 lines`, `150 lines`, etc. `CastIdentityReview.tsx:547` used the untranslated `{{lines}} lines` key, whereas the locale provides `{{count}} lines`. The root agent changed singular/plural metadata to the existing `count` keys. I reloaded and observed `12 行`, `148 行`, `150 行` and the other translated counts. `09-cast-chinese-labels-fixed-320.png` shows the repaired grid. Root owns the repair and its post-repair automated verification.

## Source-only motion and loader checks

Cast and Voices both use `CastRosterCard.tsx`; Voices adds the separate preview target. The roster motion has curve drawing, status-spine highlight, field tint, and audio bar cadence instead of moving every card upward. `roster-motion.css:120–140` disables animation, transition, and transforms for card accents, curves, fields, bloom, wave bars, new-audition icon, and home wayfinding under reduced motion. `cast-roster.css` additionally disables wave animation. I did not emulate reduced motion at runtime or measure animation performance; audit 04/05 and CI own that broader evidence.

The root App uses the same `DialogSurface` and `processing-track` for general processing, cloned auditions, and chapter generation. Review scans remain in place with a named `role=status` rather than opening a modal. Library has its own `aria-busy` skeleton, and buttons expose busy state. Raw server/fixture messages may remain English; book titles, accents, and user-entered directions are intentionally preserved rather than translated.

## Limits and follow-up

- This was a synthetic Studio gateway execution; no paid inference, real PDF extraction, filesystem audio publication, remote providers, Cloud composition, or deployment was exercised here.
- Switching the Studio Preview selector away from a running synthetic job can leave that job overlay on the next scenario until cancellation finishes. I observed and canceled it; this is a harness state-isolation limitation, not evidence that production navigation does the same.
- General stage transitions can leave focus on the document body after the prior CTA unmounts, although the specific Cast cancel and audition return/close paths restore useful focus. A shared stage-heading focus policy would improve keyboard wayfinding; this predates the scoped repairs and was not treated as a release blocker.
- A locator click at the center of the whole-card inspector may land on its overlaid initials preview target. Keyboard activation of the named inspector works. Pointer behavior follows the two visible regions; title/empty-body click coverage is validated by audit 06.

## Evidence

- `09-generation-failed-chinese-320.png`
- `09-success-export-chinese-320.png`
- `09-review-return-chinese-320.png`
- `09-dialogue-running-chinese-320.png`
- `09-generate-running-chinese-320.png`
- `09-new-audition-return-chinese-320.png`
- `09-cast-chinese-labels-fixed-320.png`
- `09-voices-playing-chinese-320.png`
- `09-dialogue-chinese-355.png`
