The boxed M background now matches the approved shared dark canvas `#293f33` from Core PR #161. The M/heart paths and foreground colors are unchanged; live unboxed marks remain transparent. Default covers retain their already-merged 25% enlargement.

Validation on macOS/Chrome: SVG source comparison confirms only the background fill changed; PNG dimensions/background pixels verified at 32, 180 and 512 pixels; Core/Cloud favicon and touch assets are byte-identical. Inspected 16/24/32/48/128-pixel marks on light and forest surfaces (see icons.png). `git diff --check` passed. Full suites and CI merge gates have not been rerun for this draft asset follow-up.

Shared UI adoption requires a future immutable Core release and Cloud pin upgrade. No release or deployment performed.
