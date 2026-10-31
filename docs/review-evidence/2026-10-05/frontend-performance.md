# Frontend performance checks

The October 5, 2026 optimization evaluates only the visible workflow page. Previously the shell
called the hook-free Extract, Dialogue, Review and Export render functions on every render, including
Home and Library. Discarded Export output still traversed all playable chapters and built their rows.
Deferred callbacks preserve the existing page mount boundaries and leave accepted state, commands,
page controls and navigation unchanged. Cast and Generate still mount as normal React components.

## Reproduce the browser measurement

```bash
npm --prefix frontend ci
npm --prefix frontend run build
node frontend/scripts/benchmark-inactive-pages.mjs /tmp/frontend-performance.json
```

The script serves the production bundle on loopback, intercepts every API request with synthetic
accepted data, and uses Chromium with 4x CPU throttling. It records 50 theme toggles after 15 warmups
while Library retains an accepted book in the workflow model. Timing ends when React commits the
changed appearance attribute; this measures main-thread render work, not painted-frame latency or
backend performance. It then opens accepted Extract, Review and Export and checks every playable
chapter remains present. There are no provider calls or real-book inputs.

Baseline source: main `0bd2be4`. Environment: Node 24.1.0, production Vite build, Chromium
153.0.8010.12 on macOS. Measured October 5, 2026 (local time); every fixture has 50 warning groups.

| Accepted chapters | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| 40 | 2.5 ms | 0.5 ms | 3.9 ms | 1.3 ms |
| 200 | 7.2 ms | 0.6 ms | 8.6 ms | 1.0 ms |
| 1,000 (stress fixture) | 30.4 ms | 0.5 ms | 33.1 ms | 1.5 ms |

Submillisecond numbers are noisy; the relevant result is removing discarded work
that previously scaled with the retained book size. Reproduce on target devices before treating these
numbers as a device budget.

The runtime logo is a 98,444-byte lossless WebP copy of the original 174,333-byte PNG (43.5% smaller).
The original source PNG remains beside it. Both are 512 by 512 pixels, and comparing decoded RGBA
bytes with Pillow confirms identical pixels. This reduces image delivery without changing layout or
introducing a runtime dependency.

## Verification

| Check | Executed result |
| --- | --- |
| `npm --prefix frontend run build` | Passed; new WebP emitted as a 98.44 kB asset. |
| `npm --prefix frontend test` | 381 tests passed in 33 files (380 existing + one host-media regression). |
| `npm --prefix frontend run lint` | Passed with the pre-existing `LanguagePicker.tsx` Fast Refresh warning; no errors. |
| `npm --prefix frontend run test:consumer` | Passed packed consumer types and development/production browser checks for host styles, action handling and modal handoff. |
| `npm --prefix frontend run storybook:check` | Passed. |
| `npm --prefix frontend run test-storybook` | 66 Chromium stories passed across nine files. |
| Production browser probe above | Zero page errors; new logo decoded at 512 by 512; accepted Extract, Review and Export opened with all 40/200/1,000 playable chapters preserved. |

The regression verifies a host's source-cover resolver remains unused outside visible Export, then
resolves and displays the cover on Export. Browser checks use synthetic data; this change does not
alter extraction, generation, providers or backend performance. Shared frontend changes require a new
immutable workflow release before a separately pinned consumer receives them.
