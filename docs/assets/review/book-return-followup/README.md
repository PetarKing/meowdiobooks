# Book return warming and temporary theme choices

The optional Three.js module starts downloading after App mounts, using the same cached request as the lazy scene. The localized “Opening your book” heading and fixed 300 × 260 art frame remain visible while loading. The canvas stays hidden through its first render; motion starts from rest. No alternate SVG or still image remains. Graphics/download failures keep the text status and never block restoration. No extra minimum wait or workflow/provider operation was added.

Browser evidence uses synthetic fixtures only. Chromium and WebKit each passed eight restoration scenarios (normal, reduced motion, unavailable WebGL, delayed/failed module, lost context, Home navigation and Library navigation), plus failed background preload on Home. The delayed-module checks compare exact art, canvas and heading rectangles before/after readiness; both positions and dimensions are identical. The reduced-motion check observes no pending animation frames, and restoration unmounts/cleans up the renderer. [Warming screenshot](warming-mobile.png), [moving screenshot](moving-mobile.png), [loader report](loader-report.json).

Device light/dark is the automatic default, including the device’s own time/sunset schedule. Manual browser choices expire after 12 hours, with reload, wake and cross-tab handling. Unknown-age old string preferences return to device mode. Controlled hosts retain authority. [Browser theme report](theme-report.json) covers device default, manual persistence/reload, tab updates, live expiry, device changes and expired reload in both engines. The clock is emulated; no OS preference is changed.

Reproduce with Vite studio mode and these commands from repository root:

```sh
npm --prefix frontend run dev -- --mode studio --host 127.0.0.1 --port 5198
node frontend/scripts/verify-book-return.mjs http://127.0.0.1:5198
node frontend/scripts/verify-theme-expiry.mjs http://127.0.0.1:5198
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:consumer
```

Final frontend suite: 396 tests in 33 files passed. Lint: zero errors, existing LanguagePicker fast-refresh warning. Production build and packed host-consumer verification passed (existing bundle-size warnings). Backend processing is unchanged. These are local implementation checks, not release publication or hosted adoption.
