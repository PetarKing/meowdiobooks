# Touch icon export correction

The previous 180×180 PNG contained a repeated, vertically cropped mark. Re-rendered the existing SVG master directly at 180×180 using Sharp, preserving the approved artwork. The hosted copy is byte-identical. The touch link declares its size and adds v=2 to request the corrected asset. Before/after image shows old on left, corrected on right.

Inspected other raster outputs (32px favicon, 512px media icon, 600×800 default cover, 1200×630 social image); no repeated mark found. Browser verification of the identical hosted copy is recorded in the companion Cloud PR. No shared component/runtime/backend behavior changed. Full Core CI gates have not been rerun for this draft.
