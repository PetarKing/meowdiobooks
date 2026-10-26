# Final quotation and review-priority verification — 2026-10-26

Scope: reusable dialogue discovery and default review ordering. No model, prompt, provider,
host configuration, or accepted user artifact is changed.

## Before and after

A synthetic excerpt ending `Alice took a breath.\n\n“We can still reach the` previously produced
no dialogue target for the final paragraph. It now produces one source-exact unlabelled target.
That target reaches the existing AI window, remains unresolved when the model returns `?`, and
can be corrected manually to Alice without adding a closing quotation or changing source text.

Recovery is deliberately limited to a quotation starting the final nonempty source block. It
supports curly/straight quotes, guillemets and both CJK quote forms. Blank trailing blocks and empty
pages do not suppress recovery. Disabled rules remain disabled; custom expressions are unchanged.
An unmatched quote inside ordinary prose or before later substantive narration is not guessed at.

The review queue previously put no-suggestion narrator fallbacks and confident AI assignments in
the same priority bucket. It now orders multiple suggestions, single suggestions, no-guess fallbacks,
then confident AI assignments. Existing checked/manual choices still resume correctly. Continue
remains disabled until the existing required-review gate is satisfied.

## Reproducible checks

- `PYTHONPATH=src python -m pytest -q tests/backend/test_dialogue_v2.py tests/backend/test_dialogue_ai.py`:
  85 passed after the final blank-tail fix.
- `npm --prefix frontend test -- src/components/DialogueResultReview.test.tsx`: 21 passed.
- The combined release-polish checkout also passed 519 frontend tests and 1,019 backend tests using
  the standard `not uses_audio_decoder and not runs_models` marker exclusions. Three decoder tests
  require `mlx_audio`, absent from the development Python environment; model inference was not run.
- Public-domain PDF extraction with pypdf followed by old/new `scan_dialogue` gave:

| Sample | Before candidates | After candidates | Source reconstruction |
| --- | ---: | ---: | --- |
| Alice | 46 | 46 | Exact, unchanged |
| Pride and Prejudice | 32 | 32 | Exact, unchanged |
| Traditional Chinese Ah Q | 12 | 12 | Exact, unchanged |

All three retained zero conflicts and structural issues. Compare the implementation on parent
`3544c83` with this branch using `scan_dialogue([{page, text}, ...])` and `reconstruct_partition`.
No provider inference is needed to test this scanner change.

Browser verification used `dialogue-review.html`'s synthetic 24-line fixture: the initial eight
multi-suggestion rows precede eight no-guess rows, which precede eight confident assignments.
At line 9 the visible card showed “No AI guess” and Continue remained disabled after skipping.
App integration tests verify the full choose/revisit/continue flow.

An independent read-only reviewer ran 345 source-preservation cases, found the trailing-empty-block
omission, then verified its fix with 45 further cases across all five quote forms. No findings remain.

## Release handoff

Requires a normal immutable shared workflow release and consumer pin adoption before deployment.
Existing accepted books are not silently reclassified. Rebuilding Dialogue after adoption makes
previously missed final-quotation targets available for review and follows normal downstream
invalidation. No production data or live workflow was changed during verification.
