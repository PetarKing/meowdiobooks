# Generate job reattachment · workflow 0.1.51

A paid return that had already dispatched a one-chapter request restored the correct
book and server job, but the Generate page displayed its ordinary all-pending selection
and omitted the generation progress dialog. The server's work was correctly scoped;
the frontend presentation was not.

The fix waits for authenticated job scope before presenting the resumed stage,
validates/deduplicates that scope against the restored book's nonempty chapters, and
uses the normal generation progress state, estimate, lock and cancellation controls.
It retains initial scope across later polls that omit settings. Legacy unknown scope
uses neutral processing progress with no invented chapter total. No command is replayed.

Settlement clears the progress UI. A failed/canceled partial run selects only requested
pending tracks, including when other tracks were published before this tab reattached.
Identity changes, explicit navigation and permanent polling failures also clear the UI;
late old-scope completion cannot restore it. Missing/deleted-book and missing-job recovery
contracts remain covered by the existing tests.

## Reproduction and tests

```sh
npm --prefix frontend test -- --run src/App.test.tsx
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
npm --prefix frontend run test-storybook
npm --prefix frontend run build-storybook
npm --prefix frontend run test:consumer
npm --prefix frontend run visual:review -- /tmp/generate-resume-canonical
GENERATION_REVIEW_URL=http://127.0.0.1:6027 node frontend/scripts/verify-generation-resume.mjs /tmp/generate-resume-browser
```

- 380 frontend tests passed. Seven new delayed-job regressions cover one requested track
  out of two, initial job lookup delay, omitted terminal payload, failure/cancellation,
  publication before reattachment, unknown legacy scope/unmount, permanent polling failure,
  and account change with late completion.
- 513 backend baseline tests passed; Ruff passed. The three optional decoder/model-marked
  tests remain excluded in the base test environment. Backend processing is unchanged.
- Production build, ESLint and Storybook types passed; ESLint retains one pre-existing
  fast-refresh export warning.
- 66 Storybook browser/accessibility tests and packaged host compatibility passed.
- Eight Chromium/WebKit mobile/desktop and light/dark reattachment/cancellation browser
  combinations passed with deterministic synthetic public-domain fixtures. Regenerate captures
  with the command above and keep them outside tracked documentation.
- Local canonical review: 95 of 96 combinations passed; desktop dark Home repeatedly reported
  contrast against the underlying illustration despite a visibly dark masking gradient. No Home/CSS
  change is included in this fix. Required CI must pass the full canonical gate before merge.
- Hosted combined-browser/staging validation and workflow recordings follow consumer adoption
  separately. Unit tests prove scoped state transitions, not deployed provider execution.

## Bounded existing provenance limitation

Generated audio snapshots do not identify the job that published each revision. After a
partial deliberate regeneration completed before reload, all requested tracks can still
be current. Reattachment cannot reliably distinguish newly saved replacements from older
current audio. When no requested pending track remains, unchanged current tracks retain an
explicit Regenerate selection; reattachment never automatically retries, regenerates, or
charges for them. Adding publication provenance would require a separate backend contract.
