# Review overlap resolution verification

The reusable source contract belongs in Core: Review resolves competing decisions against immutable
Dialogue source, then every downstream consumer renders the same versioned effective decisions.
Hosted credentials, customer artifacts and operator deployment evidence remain outside this repository.

## Behavior and compatibility

New previews and acceptances use `renderPolicyVersion: 1`; historical accepted receipts without this
marker retain their old renderer. A new acceptance stores effective decisions, while a package-private
`.audit/review-resolution/<revision>.json` records the original receipt, source/render digests,
effective decisions, and every suppressed correction or competing inclusion interval. Audit writes
precede publication; failure preserves the previous accepted state. Audit data is not included in
candidate/snapshot API responses or the UI. No new controls, messages or summary are displayed.

Precedence is independent of request order:

- Narrower inclusion scopes win. Equal-width conflicts prefer keep, then narrate, then exclude.
  Keeping a correction is not an instruction to restore an excluded passage.
- Explicitly kept corrections protect their source. Dedicated spelling choices beat general cleanup.
  Identical replacements collapse; equal-priority conflicting replacements preserve original text.
- Exclusions make contained corrections irrelevant. Partially excluded corrections are skipped whole;
  replacements are never clipped or allowed to resurrect removed text.
- Adjacent retained pieces with compatible reading context may share a correction. Different readers,
  chapters, or protected source delimiters remain boundaries.
- Two-block seam corrections have lowest precedence. Incompatible or overlapping seams are skipped;
  original source/evidence validation still rejects malformed or stale inputs.
- Saved pre-fix footnote candidates receive a narrowly proven wrapped-word continuation. No arbitrary
  note expansion or customer artifact rewrite is performed. Source snapshots and requested ranges
  remain available in the private audit.

Preview receives the current chapter decisions through the existing gateway, with no visible UI change.
Acceptance resolves after chapter assignment, so a seam crossing selected chapters is skipped in both.

## Reproduction

Baseline: `aeca6de4676fc9e22284c050cfde31d80097d314` (workflow 0.1.76).

```sh
PYTHONPATH=src .venv/bin/pytest -q -m 'not uses_audio_decoder and not runs_models'
.venv/bin/ruff check src/meowdiobooks tests
.venv/bin/python scripts/check_publication.py
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
npm --prefix frontend run test-storybook
npm --prefix frontend run build-storybook
npm --prefix frontend run test:consumer
npm --prefix frontend run visual:review -- /tmp/meowdiobooks-visual-review
# With frontend Vite running on 127.0.0.1:5186:
cd frontend
node scripts/verify-review-overlap.mjs http://127.0.0.1:5186 /tmp/review-resolution-browser
```

Focused tests cover overlapping inclusion scopes, duplicate and conflicting edits, multiple
length-changing edits, kept spelling, exclusions, compatible/incompatible reader intervals, boundary
source tampering, chapter splits, source reconstruction, recording-script repair metadata, private
immutable audits, audit failure, and legacy receipt behavior. API tests exercise preview and accept
through real routes with the actual chapter compiler. Browser checks exercise desktop and phone
Review with a synthetic gateway: one preview, original choices preserved, no rereview or automatic
acceptance. API/script tests separately verify actual backend resolution.

The three supplied public-domain PDFs (Alice 4 pages, Pride 4 pages, Ah Q 2 pages) were compared with
the baseline using native extraction and lossless narrator spans. Warning workspaces and all preview
outputs remain identical. These comparisons do not invoke attribution or voice inference.

A private read-only reproduction also exercised the original saved 130-page candidate with its saved
correction proposals: every page previews, preview agrees with the recording script, source remains
exact, and the audit records one wrapped-note range repair and one correction suppressed inside that
removed note. No provider calls or saved customer-state changes were made. Raw evidence stays in the
consuming application's ignored operator directory.

## Independent review

The requested GPT-6.1 Sol high reviewer ran existing and new contract tests, checked 1,000 generated
inclusion cases against an independent per-character oracle, and permuted competing correction
graphs. Its cue-routing validator concern was fixed and retained as a regression. Final review found
no blocker. A second fresh-context reviewer verified the real API's chapter consistency, private
audit visibility, write-failure preservation and historical-receipt compatibility; those four cases
are retained in `test_review_resolution_api.py`.

Release follows the immutable Core publication and Cloud pin/deployment gates. The Cloud outage
record authorizes local CI equivalents; exact tested commits and logs are recorded on the PR.
