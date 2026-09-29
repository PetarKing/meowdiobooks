# Shared Cast and Voices finish evidence

Captured on 2026-09-29 from the local Studio at `http://127.0.0.1:5181/studio.html`, using an agent-created background tab. The user’s tab was not changed. All displayed book content and audio came from the synthetic gateway fixture.

## Representative renders

- `cast-desktop-light.jpg`, `cast-desktop-dark.jpg`: 1440 × 900 CSS viewport; required and suggested identities, open toolbar, shared curved monogram field and status spine.
- `voices-desktop-light.jpg`, `voices-desktop-dark.jpg`: 1440 × 900 CSS viewport; the same grid design with required, available and approved auditions.
- `cast-phone-light.jpg`: 390 × 844 CSS viewport; shared bowl treatment, stable name placement, compact cast controls.
- `voices-phone-dark.jpg`, `voices-playing-phone-dark.jpg`: 390 × 844 CSS viewport; missing/available auditions and active seven-bar preview. The idle play cue disappears while playing.
- `auditions-phone-dark.jpg`, `new-voice-phone-dark.jpg`: 390 × 844 CSS viewport; audition selection sheet and the open, underlined Design/Clone choices.

The browser uses 90% page zoom: viewport overrides of 1296 × 810 and 351 × 760 produced the measured CSS sizes above. Screenshots use the corresponding physical clip to avoid the browser’s extra blank capture area.

## Observed behavior

- Selecting an audition applies it immediately and updates the applied check. Playback remains a separate action.
- Clicking the monogram starts preview playback, removes the small play cue and shows a restrained waveform; natural completion restores the initials and play cue.
- Design/Clone switches keep the creation form within the same sheet. Creating a replacement opens the explicit replacement confirmation. Confirming returns directly to the audition list containing one new Audition 1 and focuses its Play control. The fixture now replaces the set, matching the backend contract.
- No horizontal overflow at measured 1440 and 390 CSS widths. The independent audit also checked the dense 61-card Voices grid at 320 CSS px: no clipped names or horizontal overflow, and first-row names align after the shared phone content change.

## Executed checks and limits

- Focused CastVoiceReview and CastIdentityReview tests: 33 passed across two files.
- Targeted ESLint for the edited components and voice test: passed.
- `git diff --check`: passed.
- Parent integration run reports all 262 frontend tests, frontend build/lint, Storybook type check/static build and packed host contract passing.
- Reduced-motion CSS disables the new waveform/curve/icon animations and transitions. This browser exposes no supported media-emulation capability, so reduced motion was verified from source rather than rendered under an emulated preference.
- This evidence verifies presentation and synthetic workflow behavior. No live voice provider, sample transcription or production book processing was invoked.
