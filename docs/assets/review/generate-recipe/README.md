# Recipe-aware Generate verification

Base: `f136421bcf5bdbe8a68ef3f73de95836e6f6302e` (workflow 0.1.53). The changed source removes the forced Regenerate/More options action. Generate admits only unique, valid, nonempty chapters without current audio; current selected audio goes to Export. Failed or canceled jobs retry only requested unfinished tracks. A same-book recipe change can reopen an empty Generated view as To make.

The backend compares canonical compiled per-chapter render recipes from immutable Dialogue, Review, Cast and Script history. It applies Review policies, chapter mapping, voice routing, layered mixing, narration coalescing and corroborated line-break repair before comparing effective ordered voice/text inputs. The request-local cache compiles each input tuple once across a chapter list, and is shared by snapshot and Export. Missing or invalid history never establishes equivalence. No new persisted recipe, migration, provider authority or dependency is introduced. Explicit command language overrides retain their existing behavior; renderer versions and arbitrary host overrides are not inferred.

## Executed evidence

- `npm --prefix frontend test`: 419 tests passed, including current-only Export/no dispatch, direct mixed/invalid/duplicate ID admission, changed-recipe filter recovery, partial failures and resumed failures without replay.
- `PYTHONPATH=src python -m pytest -q tests/backend -m 'not uses_audio_decoder and not runs_models'`: 531 passed, 3 optional model/decoder cases deselected. This environment does not have `mlx_audio`; no real synthesis or listening-quality claim is made.
- `npm --prefix frontend run lint` and `npm --prefix frontend run build`: passed; existing LanguagePicker fast-refresh and bundle-size warnings remain.
- `npm --prefix frontend run test-storybook`: all 66 Chromium browser tests passed. `npm --prefix frontend run test:consumer`: all four host probe variants completed without errors.
- Two independent review lanes checked model admission/recovery and canonical backend recipe semantics. The historical language override concern was challenged against the explicit GenerationSettings contract and retracted as a blocker.
- The used-voice referenceMode and voiceSettings regressions were executed against the previous detector with unchanged Dialogue/Review revisions: both failed as expected (previous code falsely returned current). The changed detector passes them.
- `public-domain-probe.json`: 12 compatibility cases across all three repository public-domain PDF excerpts, comparing previous and changed detectors. This compiles native extracted text through controlled accepted two-chapter artifacts; it does not run local/remote inference or synthesize audio.

Reproduce the sample probe from the repository root with `PYTHONPATH=src python docs/assets/review/generate-recipe/public-domain-probe.py`. A local dependency environment with pypdf is sufficient. The report omits source text and temporary package paths.

Rendered desktop/mobile source-fixture captures are retained with the task review artifacts. They verify current audio has only Export, outdated audio has Generate, old audio remains listenable, and the two footer actions use equal dimensions. These are preview captures, not deployed Cloud or physical-device evidence.

Observed CSS viewports: desktop 1440 × 1000, mobile 390 × 844. Desktop actions both measured approximately 204 × 48 px; mobile actions both approximately 159 × 44 px (rounding difference below 0.01 px). Neither view had a fixture error banner or horizontal overflow. The studio resets fixture navigation when switching scenarios; the purchased story now asserts the visible Needs update label.
