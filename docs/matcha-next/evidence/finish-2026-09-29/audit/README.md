# Independent product audit — September 29

This audit used a separate hidden Studio tab and CUA browser interaction only. It inspected the source-backed synthetic candidate; it did not call voice providers or alter production books. Baselines were captured while the product agents began editing, so this folder distinguishes findings from final acceptance.

The browser was at 90% zoom. Requested viewport dimensions were corrected after measuring `innerWidth`; the initial desktop baselines have an actual CSS width of 1,600 px, and phone checks have an actual CSS width of 390 px. Screenshots may include a pale strip outside the browser content because the screenshot API reports the surrounding capture size.

## Findings delivered to the implementation lanes

| Priority | Observed issue | Evidence and disposition |
| --- | --- | --- |
| P1 | High-detail canopy behind Generate's summary/selection controls and Review's decision column reduces readability. | [Generate baseline](baseline-generate-desktop-light.jpg), [Review baseline](baseline-review-desktop-light.jpg). Root is restricting/masking the canopy to the heading region. |
| P1 | At actual 390 px, `main::before` used `right: -38px` plus animation, producing 428–431 px page scroll width. | [Voices phone baseline](baseline-voices-390-dark.jpg). Root received exact computed CSS and has removed the horizontal overflow; current Export and Review measured 390/390. |
| P1 | Initial Library error claims “No audiobooks yet,” offers Back to creating, and has no Retry despite “Try again” copy. | [Library error baseline](baseline-library-error-desktop-dark.jpg). Library agent is separating initial error from true empty and adding recovery. |
| P2 | Library cover region is a tall skinny column around a much smaller image. | [Library baseline](baseline-library-desktop-light.jpg). Library agent is rebuilding the edition composition with a natural cover region. |
| P2 | Dialogue conflict review has three nested sheets/frames and repeated “Choose for all 1 overlap” text. | [Dialogue baseline](baseline-dialogue-conflicts-desktop-light.jpg). Root is simplifying the framing and copy. |
| P2 | Cast wraps status, drag instructions and settings in an enclosing panel, while Voices uses an open header; the footer reads “1 cast labels still need confirmation.” | [Cast baseline](baseline-cast-desktop-light.jpg), [Voices baseline](baseline-voices-desktop-light.jpg). Shared Cast agent is opening the toolbar; root owns grammar and the blocker CTA. |
| P2 | Export metadata has large empty space above/below fields; phone review pagination buttons have only 19.6 px tall targets. | [Export baseline](baseline-export-desktop-light.jpg). Updated Export uses editorial fields and a compact dock; root received exact Review target measurements. |

## Hands-on checks completed before final verification

- Each primary workflow was rendered on desktop: Home, Library, Extract, Dialogue, Review, Cast, Voices, Generate and Export. Dark mode was inspected on Dialogue, Review recovery, Generate failure and Library error; phone checks covered Voices, Review and Export.
- Voices playback changed the accessible control from Play Narrator preview to Stop Narrator preview, replaced the initials with a waveform, and hid the play cue. There was no visible pause icon.
- Accepted Review → Change settings prepared the editable candidate without an extra Scan action.
- Accepted Cast → Change settings → confirmation opened Voices; Edit cast opened Cast.
- Generate failure retained the first three completed chapters; Continue to Export opened the export editor for those chapters.
- At actual 390 px, Export Clear disabled Create and showed the chapter requirement. Select all restored all three chapters. Editing Title and using Reset restored the default.
- [Updated phone Export](updated-export-metadata-390-dark.jpg) shows the in-place fields and compact floating action. Its document scroll width was 390 px.

During active source edits, HMR changed the hook order in `useWorkflowModel` and temporarily blanked the audit tab. A full reload recovered normally. Final verification must use a cold reload after the edits settle, rather than counting that transient as a production runtime failure or ignoring it without checking.

## Final independent verification

Final checks used a cold reload after the implementation lanes settled. The rendered candidate is substantially cleaner than these baselines, and the material defects above were resolved. No new error or warning logs were recorded during the final cold-reload run. These are observations of Studio fixtures, not provider execution, production acceptance, or release evidence.

| Area | Observed final result | Evidence |
| --- | --- | --- |
| Shared Cast/Voices grid | The curved divider, colored portrait field, status accent and compact layout are shared. At actual 320 px, all 61 dense Voices tiles fit without document overflow or clipped names. Alice & White Rabbit and Narrator names align at y=661.6 after the final shared CSS correction. | [Desktop Voices](final-voices-1440-dark.jpg), [dense phone Voices](final-dense-voices-320-light.jpg) |
| Voice dialog | At 390 px, the modal and Close control stay above the sticky header, including after page scroll. Tab remains within the dialog and Escape restores focus to Open Alice voice. At 1440 px, the dialog is centered from x=220 to x=1220 and Close is topmost. | [Desktop voice dialog](final-voice-modal-1440-dark.jpg) |
| First and replacement auditions | First Alice audition creates directly and returns to the audition list focused on Play Audition 1. Existing audition regeneration opens a truthful replacement confirmation. Keep current auditions cancels to the Generate CTA and retains the candidate. Confirming replacement returns to the list with exactly one replacement candidate rather than appending to the previous set. | [First audition](final-first-audition-390-light.jpg), [replacement return](final-replacement-audition-390-light.jpg) |
| Library and error recovery | Phone covers render at 108 × 144 px with zero enclosing cover padding. Initial error has Retry and does not falsely claim an empty Library. Retry attempts recovery in the deliberate persistent-failure fixture. Refresh failure preserves both edition titles and offers Retry. All three states measured 390/390 px. | [Library](final-library-390-dark.jpg), [initial error](final-library-error-390-dark.jpg), [refresh failure](final-library-refresh-failed-390-dark.jpg) |
| Home | The six local books use a three-column desktop shelf; long and Japanese titles fit. All Delete targets are 44 × 44 px. Document width is 1440/1440 px. | [Six-book Home](final-home-six-1440-dark.jpg) |
| Generate and Dialogue | Generate summary and selection tools sit below the artwork; Dialogue conflict evidence and choices use an open composition rather than nested outlined sheets. Both desktop states remain readable in dark mode. | [Generate](final-generate-1440-dark.jpg), [Dialogue conflicts](final-dialogue-conflicts-1440-dark.jpg) |
| Review | Phone Previous/Next controls now measure 44 px tall. Next advances Example 1 to Example 2. The document stays 390/390 px. Accepted settings can be reopened without an extra Scan action. | Baseline retained above; final behavior and geometry measured through CUA. |
| Export | At 1440 px the edge-to-edge cover is 444.8 × 588.3 px and details use an unboxed editorial composition. At 320 px, the 20-chapter fixture has no overflow; the floating dock is 61.1 px tall at y=771.4–832.5. At the end of the document it expands into the 139.1 px release bar at y=683.3–822.4, with the output choices and Create action reachable. Clear disables Create; Select all restores it. Title editing and reset work. | [Desktop Export](final-export-1440-light.jpg), [phone floating dock](final-export-20chapters-320-light.jpg), [phone document end](final-export-end-320-light.jpg) |

### Motion and scope limits

Source inspection confirms reduced-motion rules for the canopy, shared roster curve/light sweep, playback waveform/bloom, audition/dialog transitions, Home wayfinding, Library shimmer and Export fields. The browser capability does not expose reduced-motion emulation, so that preference was **not** rendered or measured in this audit. Normal playback and its accessible Play/Stop state were exercised; animation appearance remains a design judgment, not a measured quality score.

Primary workflow states were inspected across the baseline and final runs; representative final checks used actual CSS widths of 1440, 390 and 320 px in light and dark mode. This is not a claim that every fixture was rerun at every width/theme. No real voice provider, real sample upload, production export or adoption was performed.
