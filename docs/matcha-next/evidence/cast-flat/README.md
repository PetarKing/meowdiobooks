# Cast roster correction — rendered evidence

This square-panel pass is retained for comparison. The [current portrait-playback revision](../cast-listen-portrait/README.md) removes the separate Listen action and per-card metadata.

The previous arched cards read like coffins and overloaded the top of each tile with a number and selection bubble. The current roster uses square portrait panels with centered initials, left-aligned names and voice-state text. A slim colored edge signals a chosen voice. Generic character labels were removed; group voices still identify their category. Portrait tones derive from the stable character ID so filtering does not recolor a character.

[Desktop light](roster-1440-light.png), [desktop dark](roster-1440-dark.png), [phone light](roster-390-light.png) and [phone dark](roster-390-dark.png) show the current source-backed preview. [The interaction report](report.json) repeats the four-state Cast check: one-click audition selection, Ghost, confirmation focus, scoped accessibility, no horizontal overflow, native dialogs, runtime errors or API calls. [Dense-cast evidence](../cast-flat-dense/report.json) checks 61 voices and long-name bounds in the same four states. The preview remains synthetic; it does not generate voice audio.

Run from `frontend/` with the local studio:

```sh
node scripts/review-cast-stage.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-flat
node scripts/verify-cast-independent.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-flat-dense
```
