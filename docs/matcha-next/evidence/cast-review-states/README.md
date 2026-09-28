# Cast and Voices review states

These are synthetic design fixtures, not provider audition results. In the Studio preview, choose **Cast · required and suggested review** or **Voices · required and optional review** from the Preview menu. The matching Storybook stories are `CastReviewStates` and `CastVoiceReviewStates` under Product/Studio.

Cast shows a red Royal Chorus group whose identity must be confirmed before generating auditions, an amber Queen of Hearts suggestion that can be inspected without blocking, and ready members. Voices shows a red Alice without an audition, amber playable voices that can be approved together when continuing, and an approved Hatter.

`frontend/scripts/verify-cast-review-states.mjs` captured 1440 px and 390 px in light and dark appearance. It verified the visible status labels and inspector explanations, no horizontal overflow or JavaScript errors, and the actual progression gates: required Cast identity blocks Continue until confirmed; missing Voice audition blocks acceptance until a new audition exists; advisory cases remain visible and permit the next step, with a batch-approval confirmation for unselected auditions. Results are in [report.json](report.json), with representative grid and inspector screenshots alongside it.
