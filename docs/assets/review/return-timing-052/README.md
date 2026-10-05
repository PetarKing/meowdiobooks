# Quiet returns and concurrent hydration

The return status is immediately available in a quiet text treatment. The decorative book and
atmosphere mount only after 800 ms; returning content never waits for that timer or a minimum
animation duration. The integrated loader retains the merged optional-graphics behavior: no alternate
static book, text survives graphics failure, and canvas readiness precedes its reveal.

Hydration still obtains an authoritative snapshot and prepares a missing recording script first.
Pending immutable candidate reads and the independent Dialogue preview then start together. No
hydrated state commits until the read group resolves, and identity/navigation guards still apply.
These are read-order and presentation changes, not provider, authority, or persistence changes.

## Executed evidence

The archived baseline is Core `0bd2be4` (.51). The changed source includes merged PR98 and the
quiet-return/concurrent-read change. All browser fixtures use synthetic books and prohibit provider
commands; these timings do not measure deployed API latency or promise a general speedup.

[Timing report](timing-report.json): sixteen controlled browser cases, Chromium and WebKit, each
comparing 100 ms, 600 ms, 1100 ms snapshot waits and four 120 ms candidate reads. Fast and ordinary
returns never mounted book art after the change. Sustained waits mounted it at 808–809 ms, then
returned as soon as content was ready. Candidate requests started in the same millisecond rather
than sequential intervals. WebKit's single controlled candidate sample decreased from 576 ms to
186 ms; Chromium showed larger baseline rendering overhead. These are bounded single-run samples,
not statistical benchmarks.

[Sustained-loader report](sustained-loader-report.json): eighteen browser cases passed across both
engines: normal, reduced motion, unavailable WebGL, delayed/failed module, context loss, Home,
Library, and background preload failure. The renderer cleans up after navigation/completion and
graphics failure keeps the readable status. Fourteen targeted React regressions also passed on the
integrated source, covering the delay, candidate concurrency/failure, scoped job restoration,
identity cleanup, and missing/deleted-book recovery.

Reproduce with separate baseline and current Vite roots (use separate dependency caches):

```sh
node frontend/scripts/verify-return-timing.mjs http://127.0.0.1:5229 http://127.0.0.1:5230
node frontend/scripts/verify-book-return.mjs http://127.0.0.1:5230
```

Build and full release checks are owned by the combined candidate's release record. This evidence
does not establish release publication or hosted adoption.
