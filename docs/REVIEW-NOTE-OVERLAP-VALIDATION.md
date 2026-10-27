# Review note overlap verification

Baseline: `aeca6de4676fc9e22284c050cfde31d80097d314`. Tested on macOS, Python 3.12,
Node 22, with the locked dependencies. No inference provider was called.

## Reproduction and expected behavior

The synthetic source `[4] A scholar stud-\n ied the records.\nStory resumes.`
previously produced a footnote ending at `stud-`. Excluding that note while joining
the wrapped word failed with `Cleanup repair crosses another review decision`.
The new note range includes the continuation line. Preview and recording-script
checks now exclude the complete note, preserve `Story resumes.`, and reconstruct
the original source exactly. The overlap guard remains active for saved drafts
with the historical partial range; no saved decision is rewritten.

`tests/backend/test_review_note_overlap.py` covers both spelling choices, soft
hyphens, CRLF, tabs, chained wraps, blank lines, note/chapter boundaries,
following lowercase prose, immutable inputs, and saved-draft conflict recovery.

## Commands

From the repository root after installing the locked development dependencies:

```sh
PYTHONPATH=src .venv/bin/pytest -q -m 'not uses_audio_decoder and not runs_models'
.venv/bin/ruff check src/meowdiobooks tests
.venv/bin/python scripts/check_publication.py
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
```

For the real Chromium interaction check, start the development server in one terminal:

```sh
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5186
```

Then run:

```sh
node frontend/scripts/verify-review-overlap.mjs http://127.0.0.1:5186 /tmp/meowdiobooks-review-overlap
```

The script writes screenshots and `report.json` for desktop (1440 px) and phone
(390 px). It uses a synthetic in-memory gateway: the first preview fails, the
decision view returns with actionable guidance and the selected correction, and
changing that correction to Keep original text allows preview to succeed.
Footnote exclusion remains selected and nothing is automatically accepted.
The App tests additionally check chapter choices, network errors, valid empty
previews, and obsolete failures after returning to decisions and reopening.

## Public-domain sample comparison

Native extraction and lossless narrator spans were passed through the baseline
and changed Review implementations. Workspaces and every preview page were
identical for these unmodified samples:

| Sample | Pages | Source reconstruction | Workspace / preview |
| --- | ---: | --- | --- |
| Alice explicit dialogue | 4 | Exact | Identical |
| Pride inferred multispeaker | 4 | Exact | Identical |
| Ah Q traditional Chinese dialogue | 2 | Exact | Identical |

This checks Review range behavior, not speaker-attribution accuracy or voice
generation. A separate private operator check regenerated a workspace from the
affected 130-page book's existing accepted inputs and previewed all pages
successfully; no saved customer state changed. Private artifacts are excluded
from this repository.

Two independent reviews examined source-range safety and frontend recovery/races;
neither found a blocking issue. Shared release publication, Cloud pin adoption,
and Alpha deployment remain separate follow-up steps.
