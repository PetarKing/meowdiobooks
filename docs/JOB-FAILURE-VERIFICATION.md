# Workflow failure reporting verification

The queue exposes reviewed public recovery text while a local logger or an optional host callback
retains the original exception. The callback is additive and contains no provider, account, storage,
or deployment policy. Synchronous voice and export operations have a separate callback because they
do not use the background queue.

## Reproduce

Using the development Python environment with the repository's source on `PYTHONPATH`:

```sh
PYTHONPATH=src python -m pytest -q tests/backend -m 'not uses_audio_decoder and not runs_models'
python -m ruff check src/meowdiobooks/backend/queue.py src/meowdiobooks/backend/app_v2.py src/meowdiobooks/backend/audio.py src/meowdiobooks/backend/transcription.py src/meowdiobooks/backend/errors.py tests/backend/test_job_diagnostics.py tests/backend/test_operation_diagnostics.py tests/backend/test_app_v2.py
```

On macOS / Python 3.12, the final backend run passed 758 tests with three decoder/model tests excluded.
The targeted lint check and TypeScript check of the translation catalog passed. The environment emitted
one existing Starlette/httpx deprecation warning. An earlier run including the optional real audio
decoder could not run that scenario because `mlx_audio` was not installed; this is not a model or
real-provider execution claim.

## Observable before/after cases

| Synthetic trigger | Before | After / evidence |
| --- | --- | --- |
| Each registered workflow command raises a provider exception | Exception class and raw diagnostic appear in persisted job error; no queue log. | Safe retry guidance; callback receives the identical exception and traceback, with persisted failed job ID/kind/attempt. `test_job_diagnostics.py` parameterizes the real command registry. |
| Host failure reporter itself raises | No hook available. | Job is already settled, subsequent jobs succeed, and only job metadata enters fallback logs. |
| Canceled work, required host action, exception after irrevocable publication | Existing cancellation/action/publication semantics. | Semantics preserved; no failure callback for these outcomes. |
| Source changes or dialogue rules conflict | Raw exception details in job response. | Corrective guidance in response; original reason in operator logs. Existing API regressions verify processing stops before parsing/provider calls. |
| Voice normalization, transcription or clone adapter raises | Some raw decoder/provider errors returned; others swallowed by HTTP translation. | Callback receives original exception and operation/book context; HTTP response is safe; temporary samples and new voice files are cleaned. Required host actions and explicit input validation remain actionable. |
| Export encoder, cover processor, Library-directory creation or durable-save hook fails | Diagnostic can be lost during HTTP translation; directory setup can bypass cleanup. | Original exception reported with `export`/`export-save`, public recovery guidance retained, temporary export workspace removed, no Library entry published. |

All documents/audio used here are synthetic test fixtures. The source parsing, text attribution,
voice synthesis and packaging algorithms are unchanged, so public-domain book/model evaluation is not
required for this reporting-boundary change. An independent implementation review covered callback
ordering, cancellation, post-publication behavior, private response handling and cleanup; its two
findings (clone normalization and pre-save directory failures) were fixed and covered by regressions.

This evidence does not establish release publication, companion adoption, deployment, native worker
crash retention, or universal HTTP exception coverage. Process crashes cannot invoke Python callbacks.
The interrupted-job marker remains compatible with existing consumer recovery handling.
