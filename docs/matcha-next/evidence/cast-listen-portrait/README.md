# Quiet Cast roster and portrait playback

The current roster keeps a restrained Matcha & Cherry palette. Each card has two independent targets: the initial portrait plays or pauses a voice, while its name opens the audition inspector. During playback, the initials become a small five-bar sound motif and return when playback pauses, ends, switches to another voice, or the inspector opens. Reduced-motion mode keeps the bars static. The separate Listen footer, line count and repeated “default ready” or “voice selected” copy are gone. A slim edge and small check or exclamation mark show selected or required state; the full state remains in each card’s accessible description and the workbench summary.

[Desktop light](roster-1440-light.png), [phone dark](roster-390-dark.png), [playing desktop](playing-1440-light.png) and [playing phone](playing-390-dark.png) are source-backed captures. [The playback report](playback-report.json) checks play, pause, audio end, switching, inspector separation and reduced motion across both widths and appearances. It stubs the synthetic silent fixture’s media methods to hold each UI state for inspection, then runs a real browser playback of the fixture’s four-second WAV through to completion. This verifies transport behavior, not real voice-audio quality. [The Cast report](report.json) checks the existing audition and dialog flows with no scoped accessibility violations or overflow. [Dense-cast evidence](../cast-listen-portrait-dense/report.json) checks 61 voices and long names in both themes and widths.

From `frontend/`:

```sh
node scripts/review-cast-stage.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-listen-portrait
node scripts/verify-cast-portrait-playback.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-listen-portrait
node scripts/verify-cast-independent.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-listen-portrait-dense
```
