# Host action and return recovery verification

The change keeps host intervention separate from ordinary workflow failure. It adds a
provider-neutral `{code,message,context}` descriptor persisted on failed jobs, preserves synchronous
voice endpoint descriptors without publishing artifacts, and lets a host handle expected actions.
Only a callback returning `true`, or an explicitly handled typed transport error, suppresses errors.
Existing funding, provider selection and retry authorization remain host responsibilities.

The explicit initial book/step/job hint hydrates current state and reattaches an already-dispatched
job even when browser storage throws. It never repeats a command. An identity change invalidates
the hint; hosts still remount App on identity and explicit return changes.

## Execution

Validated on macOS arm64 with Python 3.12, Node 24.1, locked frontend dependencies and synthetic
books/audio. No paid provider requests, deployed application or real checkout was used here.

- `npm --prefix frontend test -- --run`: 339 passed across 31 files. Includes handled synchronous
  and queued generation, unhandled actions, restored failed jobs with original settings, explicit
  no-storage job return, identity isolation, and paused transcription requiring an explicit retry.
- `PYTHONPATH=src python -m pytest tests/backend -q -m 'not uses_audio_decoder and not runs_models'`:
  504 passed, 3 deselected. New tests verify queue descriptor round-trip and worker survival,
  invalid/unserializable attachments, synchronous transcription temporary-file cleanup, and clone
  rejection with no new audio or accepted-cast publication.
- Final focused backend recheck of `test_action_required.py`, `test_app_v2_finish.py`, and
  `test_storage_queue.py` with the same marker exclusions: 46 passed, 1 deselected.
- `npm --prefix frontend run build`: strict TypeScript and Vite passed; existing large-chunk warning.
- `npm --prefix frontend run lint`: 0 errors; existing LanguagePicker Fast Refresh warning.
- `python -m ruff check src/meowdiobooks tests`: all files pass. `git diff --check` passes.
- `npm --prefix frontend run test:consumer`: a freshly packed package typechecks from a separate
  host and renders standalone primitives plus App host composition in Chromium with no page
  errors. Host CSS overrides retain the expected cascade. Local server execution required the
  sandbox network exception.

The full local audio-decoder/model paths were excluded because this verification environment lacks
the optional MLX runtime. An attempted decoder test failed on missing `mlx_audio`, before the provider
boundary. This is not evidence of local inference compatibility, real Stripe authentication,
redirects, webhook timing, funding eligibility or deployed hosted UI; those require consumer-side
and staging evidence. The public planning aliases preserve existing cast algorithms; source
availability and exact model/recipe validation remain required by compositions.

## Packed entry-point regression

The actual hosted rendering found that development dependency optimization can create separate
`ActionRequiredError` constructors for App's internal module and the public `/api` entry point.
Constructor identity then produced a generic workflow alert even after the host displayed the
required action. The error now carries an explicit brand, and exported `isActionRequiredError`
checks that brand, descriptor and handled flag across all handling/preservation paths. Ordinary,
malformed and host-declined errors remain visible.

- `WORKFLOW_CONSUMER_REF=6278fef npm --prefix frontend run test:consumer` reproduces the old
  real App/public API failure: `development: handled expected-action visibility`.
- The expanded packed-consumer script passes against the fix in both Vite development and a
  built production preview. Already-handled and host-delegated actions show no workflow alert;
  a host-declined action retains its message and Retry. Both use the actual App and public API
  export, with no duplicate workflow implementation. Strict host types and both CSS consumer
  cases also pass; there are no browser page errors.
- Full frontend suite: 341 passed across 31 files. Focused App/API/transcription suite: 209 passed.
- Strict TypeScript/Vite production build and lint pass, with the existing chunk-size and
  LanguagePicker Fast Refresh warnings.

The consumer script's former conditional dynamic-import expression was changed to literal import
branches so its production build tests built JavaScript rather than requesting source TSX files.
These isolated package checks do not establish the full companion application's production build
or deployed UI behavior; companion validation remains separate.
