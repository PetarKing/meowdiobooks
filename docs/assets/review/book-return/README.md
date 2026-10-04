# Book return — accepted design and verification

The plain “Restoring your book…” line becomes a single **Opening your book**
status with a procedural clothbound book, a curled page turn, and six faint
sakura petals. The book and copy keep a clear central area. The animation adds
no minimum wait: the authoritative snapshot, errors, and explicit navigation
still determine when this state ends.

The Three.js scene is a lazy chunk (132.71 kB gzip in the local production
build), used only by this loading state. A static SVG appears while it loads,
when its download fails, or when WebGL is unavailable/lost. Reduced motion
renders a static scene and stationary petals; hidden tabs stop the scene loop.
Unmount removes listeners, cancels frames, and disposes graphics resources.
Three.js 0.186.1 and its type declarations 0.186.0 are pinned. Types are a package
dependency because the shared UI distributes TypeScript source to hosts.
No external art assets or graphics requests are used after the chunk arrives.

## Inspectable evidence

- [Before](before-mobile.png): original loading state at Core `6278fef`; its
  markup is unchanged in the implementation baseline `cdefb3c`.
- [After](after-mobile.png): actual production source under a synthetic gateway.
- [Accepted motion](approved-motion.mp4): the approved procedural scene/petals;
  production preserves their geometry, timing, palette, and layout.
- [Lost-context fallback](fallback-dark.png): one static book after context loss.
- [Browser report](browser-report.json): 16 independent Chromium/WebKit scenarios
  under React StrictMode, including lazy delay/failure, no WebGL/context loss,
  normal/reduced motion, snapshot completion, Home/Library navigation, and
  renderer cleanup. Zero provider commands, page errors, or remaining frames.

The context-loss check found a real cascade issue: Three's inline canvas display
kept it visible behind the SVG. The explicit hidden-canvas rule fixes it; both
engines assert `display: none` and their screenshots show one book.

## Reproduce

```sh
npm --prefix frontend ci
npm --prefix frontend run dev -- --mode studio --host 127.0.0.1 --port 5192
# In a second terminal, from the repository root:
node frontend/scripts/verify-book-return.mjs http://127.0.0.1:5192
```

The committed `/design-kit/book-return/index.html?appearance=light` fixture
holds a synthetic book snapshot; `window.finishBookPreview()` releases it.
It cannot start provider work. Review fixtures/scripts are excluded from the
consumer package; source components and their stylesheet are included.

Local checks: 348 existing frontend tests plus the new localized graphics-failure
regression; ESLint (zero errors, one pre-existing warning); TypeScript, production
build, Storybook types, packed-host compatibility; Ruff; and 513 backend tests
with CI's three audio/model cases deselected. Initial backend collection was
rerun successfully with CI's `PYTHONPATH=src:.` source path. Runtime dependency
audit reports no advisories. CI supplies the remaining Storybook/canonical-screen
and Linux checks. Browser evidence is synthetic, not a physical-device run.
