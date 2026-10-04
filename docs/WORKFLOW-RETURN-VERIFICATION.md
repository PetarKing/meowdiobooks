# Workflow return verification — October 4, 2026

## Intended behavior

Reloads restore the selected book and stable journey step even after its active-job marker is removed.
Snapshots remain authoritative: the UI reloads pending candidates and accepted state, reattaches a
running job, then reloads the snapshot when it settles. Recovery does not issue a provider command.
A saved extraction candidate needs explicit acceptance; a saved Review scan reopens for inspection.
Home, Library, an explicit Library URL, and a changed host identity take precedence over stale work.
Only a missing/invalid top-level book snapshot discards its destination; nested failures offer Retry.
Hosts scope return hints with `workflowPersistenceNamespace` and remount on identity changes.

## Executed checks

Runtime: macOS arm64, Node 24.1.0, Chromium 153.0.8010.12. Dependencies reuse the exact frontend lockfile.

```sh
npm --prefix frontend test -- --run
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5188
node frontend/scripts/verify-book-resume.mjs after /tmp/meow-book-resume http://127.0.0.1:5188
node frontend/scripts/verify-workflow-return.mjs /tmp/meow-workflow-return http://127.0.0.1:5188
```

The complete frontend suite passed 328 tests across 30 files. Build and lint passed; lint retains one
pre-existing `LanguagePicker` fast-refresh warning. Unit/UI regressions cover completed and running
jobs, disappeared jobs, pending Dialogue/Review/Extraction, explicit navigation, account changes,
stale snapshots, transient snapshot Retry, nested candidate 404, invalid hints, unavailable storage,
and foreground/offline polling recovery.

The shelf/reload browser check passed English and Chinese at widths 320, 390, 749, 750, 751 and 1440.
The lifecycle check passed at 390 and 1440: Chromium froze the page via CDP while the synthetic worker
finished; wake reopened the Dialogue result, a subsequent reload restored it after the job marker was
cleared, a snapshot outage retained the destination and Retry recovered it, and Home/Library reloads
stayed in the selected product area. No provider or extraction-preview request ran during return.
At 390, Library uses an explicit URL because the local shell hides its desktop tabs on mobile.

The gateway, source content and worker state in these checks are synthetic. The CDP check exercises
browser freezing and fresh-document reload; it is not a physical-phone or staging deployment check.

## Inspectable evidence

- [Lifecycle report](assets/review/workflow-return/report.json)
- [Mobile running step](assets/review/workflow-return/running-390.png)
- [Mobile finished step after reload](assets/review/workflow-return/finished-after-reload-390.png)
- [Mobile interaction recording](assets/review/workflow-return/workflow-return-390.webm)

The scripts regenerate desktop and mobile screenshots and recordings without using account data.
