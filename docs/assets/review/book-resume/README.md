# Working-book resume verification

Base: `33ccaf9` (workflow 0.1.38). Verified on 2026-10-02.

## Findings and scope

The homepage hid any book whose nullable `source_name` was empty, even when the
gateway could reopen its saved workflow. A failed initial `listBooks` request was
also silently treated as an empty collection, with no retry. The fix displays all
gateway-returned working books and provides localized loading/error/retry feedback.
An in-flight request from a replaced gateway cannot overwrite its successor.

The original friend's deployment and failing response were unavailable. These are
confirmed shared-UI defects, not proof of that incident's exact trigger. Independent
local-backend verification found that PDF import, pending dialogue, and accepted
dialogue survived reopening the application against the same temporary data store.

## Reproduce

```sh
npm --prefix frontend ci
npx --prefix frontend playwright install chromium
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
# In another terminal:
node frontend/scripts/verify-book-resume.mjs after /tmp/meow-book-resume
```

Before screenshots were captured with the same script's `before` mode against the
unmodified application at the base commit. That mode asserts the saved book is
absent. To repeat the baseline, copy the script into a separate checkout of the
base commit, install its frontend dependencies, and run its development server.

The browser harness renders the production App with the existing synthetic gateway,
an accepted dialogue snapshot, and a null source filename. Only the book-list
transport is simulated; all production-backend requests are blocked. It reloads the
document, tabs to Continue, presses Enter, confirms the Review stage, then simulates
a failed list request and delayed successful retry. It checks visible keyboard
focus, Continue target height, error-text width, and horizontal overflow. This does
not exercise hosted authentication, real network storage, or inference providers.

## Evidence

Chromium 153.0.8010.12, Darwin 25.6.0 arm64, Node 24.19.0; English and Chinese.
Viewports: 320×568, 390×900, 749×900, 750×900, 751×900, 1440×900.
No breakpoint or style rule changed; the existing 750px transition is covered.
All 12 final browser cases passed; see [browser-report.json](browser-report.json).

- Phone: [before](before-en-320.png), [after](after-en-320.png).
- Desktop: [before](before-en-1440.png), [after](after-en-1440.png).
- Chinese phone: [saved book](after-zh-CN-320.png), [retry](error-zh-CN-320.png).
- [Keyboard, reload, resume, and retry recording](resume-en-390.webm).

Only representative sanitized evidence is retained here. All content uses existing
redistributable synthetic fixtures; no personal books or backend data were accessed.

## Automated verification

```sh
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
PYTHONPATH=src uv run --no-sync pytest -q tests/backend/test_storage_queue.py tests/backend/test_app_v2.py
git diff --check
```

- Regression-first run: two failures (hidden null-filename book and silent list
  failure), one pass (ordinary filename-bearing book after remount).
- Final frontend suite: 301 passed, one unrelated failure in the unchanged
  `src/api/client.test.ts:372`: `download.blob.text is not a function`.
  Independently reproduced in the isolated client suite (23 passed, one failed).
- New regressions cover null/empty/present filenames, remount and resume without
  importing again, loading/retry, and a replaced gateway's stale response.
- Lint: no errors; existing LanguagePicker fast-refresh warning.
- Build: passed; existing bundle-size warning. Initial build was blocked by empty
  duplicate `@types/* 3` directories in local node_modules; removing those empty
  generated folders resolved it without changing dependencies or configuration.
- Backend: 42 passed. Plain `uv run pytest` initially failed collection because
  this local editable environment could not resolve `meowdiobooks.backend`;
  `PYTHONPATH=src` resolved collection. No backend source changed.
- Full model/audio evaluation was not run: extraction, attribution, and generation
  behavior are unchanged. Safari, Firefox, and the friend's deployment are untested.

Release note: Saved working books remain reachable even when source filename
metadata is absent. If the book list cannot load, Home now offers a retry.
