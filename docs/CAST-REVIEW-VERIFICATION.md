# Cast and script-direction verification

Changes target reusable workflow behavior: stable cast ordering, visible default auditions,
and explicit review of parenthetical directions in label-colon scripts. No provider or
companion-specific policy is introduced.

## Reproduction and results (2026-10-22)

- Python 3.12, native Mac dependencies: `PYTHONPATH=src python -m pytest -q tests`:
  561 passed. `ruff check src tests`: passed.
- Frontend: `npm test -- --run`: 421 passed. ESLint: no errors (existing LanguagePicker
  fast-refresh warning). Production build passed (existing chunk-size warning).
- Browser component flow using the CastVoiceReview test fixture: open Many, observe Audition 1
  pressed and labelled Default audition; apply Audition 2, observe only Audition 2 pressed;
  close inspector. Card order remains Narrator, Many, Few before and after approval.
  Bulk acceptance regression confirms that the displayed first audition is accepted.
- Independent UI and annotation reviews completed. Annotation verifier exercised 36 additional
  probes covering leading, inline, nested, unclosed and repeated cues, multiple speakers and
  manually corrected speaker origins. All preserve source coverage and label omission.
- Review/recording-script regression tests cover exclude, keep and narrate choices. Exclusion
  produces an unspoken source range; it never deletes source evidence or speaks the speaker label.
  Unclosed parentheses remain untouched; invalid source bounds retain existing recovery handling.

The three public-domain PDFs in `SampleBooks/public-domain-evaluation` were extracted with
pypdf and scanned with the default dialogue scanner, then passed through Review. Alice: 4 blocks,
96 spans; Pride: 4 blocks, 68 spans; Ah Q: 2 blocks, 26 spans. All reconstructed the source exactly;
none gained a script-direction warning. This is a scoped source/review regression check, not a
new local-versus-remote attribution or listening evaluation. No attribution or synthesis model
has changed.

Before this change, explicit script parentheticals had no dedicated warning and splitting a
speaker span could turn the label into speech. Now balanced parentheticals in label-colon
speech require an explicit Review choice. Parenthetical prose outside that format is unchanged.
Previously, approval reprioritized cards and the implicit latest audition was not marked as
selected. Now review status does not reorder cards, and the first playable audition is shown
as the default; an explicit choice always wins.

Existing accepted manuscripts and audio are not rewritten. Users can revisit Review, choose
which directions are spoken, then reaccept downstream stages and regenerate affected audio.
