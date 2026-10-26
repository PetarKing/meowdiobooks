# Narration language verification

Source: the synthetic `Workflow/Casting confirmation` Storybook fixture and its Chromium interaction.
The fixture starts with detected French (score 0.9) and English (score 0.1). The interaction verifies
French is preselected, is first in the list, and permits generation after its quote settles. It then
selects English, closes the modal and reopens it, checking that English remains selected.

The screenshots show the final reopened dropdown: French retains its first position while the
user's English selection remains checked. Scores are ordering hints and are not displayed as
calibrated percentages. `browser-state.json` records the option order, selected option and browser
errors captured for each frame.

| Viewport | Light | Dark |
| --- | --- | --- |
| Desktop (1440 × 1000) | [Screenshot](1440-light.png) | [Screenshot](1440-dark.png) |
| Phone (390 × 844) | [Screenshot](390-light.png) | [Screenshot](390-dark.png) |

Reproduce with `npm --prefix frontend run test-storybook` and the `Detected language` story; use
`npm --prefix frontend run build-storybook` to produce a static review build. The interaction is
checked in at `frontend/stories/CastingConfirmation.stories.tsx`.

The full pre-integration validation passed 1,251 backend tests (three model/audio exclusions), 556
frontend tests, 84 Chromium/accessibility stories, packaged consumer checks and all 100 canonical
visual/accessibility combinations. After merging the speaker-color change from `main`, 36 relevant
backend tests (one audio exclusion), 229 relevant frontend tests and the Storybook build passed.
