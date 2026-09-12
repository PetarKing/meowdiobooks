# PR 53 recovery evidence

Historical evidence from July 2026. The recorded Enrich phase was removed before release; the current
workflow goes directly from Cast & Voices to Generate.

The [recovery walkthrough](./recovery-walkthrough.mp4) uses a sanitized,
synthetic one-page book and records:

1. reopen into the malformed-Dialogue recovery screen;
2. deterministic preview with the previous settings;
3. an explicit corrected-result acceptance; and
4. downstream Review, Cast & voices, Enrich, and Generate invalidation.

No private book, credentials, generated audio, or unredistributable material is
included.

## Environment

- Captured: 2026-07-23
- Browser: Codex in-app browser (browser plugin 26.715.72359)
- Browser engine version: not exposed by the browser-control API
- Operating system: macOS 26.5.2 (build 25F84)
- Desktop viewport: 1440x900
- Mobile checks: 375x812 and 320x568
- Languages checked: English and Simplified Chinese

## Verification notes

- The recovery action measured 44px at every checked viewport, with no
  horizontal overflow.
- At 320x568 the action begins below the fold in both locales and is reachable
  by normal scrolling.
- The recovery, preview, and acceptance controls visibly retain keyboard focus
  in the walkthrough.
- The recovery click sent only the deterministic preview request. The later
  process request used narrator fallback and reported zero AI contributions.
- Acceptance activated the corrected Dialogue revision, cleared
  `dialogueRecovery`, and left no audio artifact or audio file.
- The local deterministic job completed too quickly for a stable loading-overlay
  frame; its accepted response, polling, candidate fetch, and acceptance were
  verified in the server log.
- No breakpoint changed, so one-pixel-below/above breakpoint captures do not
  apply to the global minimum-height correction.
