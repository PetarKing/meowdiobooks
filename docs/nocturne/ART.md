# Nocturne artwork

The pantheon is a decorative studio installation, not a depiction of a book's characters or a promise about provider output. All product text, controls and status remain live HTML.

- Generated with the built-in imagegen tool on 2026-09-26.
- Editable source: `art/nocturne-master.png` (1536 × 1024 PNG).
- Runtime asset: `../../frontend/src/assets/brand/nocturne-pantheon.webp`, encoded with `cwebp -q 88` (168,042 bytes).
- `StudioHero.tsx` composes the image, editorial heading and pointer parallax.
- `SoundField.tsx` lazily loads Three.js for a true depth-based light field and acoustic ribbons. It does not analyze or imply audio playback.
- Reduced motion retains the finished illustration and disables the decorative loops. Missing WebGL or browser enhancement APIs uses the same static fallback. Rendering pauses offscreen and when the document is hidden; resources are disposed on navigation.

## Generation prompt

Use case: stylized-concept. Asset type: cinematic wide artwork for Meowdiobooks, a literary audiobook studio UI. Create a premium surreal architectural still life, panoramic 3:2 composition. A monumental lavender stone pantheon/library arch in a midnight aubergine void, sculptural open book levitating at center-right above a polished circular black stone plinth. Extremely refined lilac glass and paper materials, delicate glowing coral and pale lilac acoustic wave ribbons emerging from the book, tiny star-like dust. One subtle abstract cat-ear silhouette worked into arch architecture, not a cute cartoon. Sophisticated editorial art, high-end museum installation / physically rendered 3D, dramatic volumetric side light, deep velvety shadows, restrained iridescence. Architecture dominates, book readable as a book; avoid clutter. Right two thirds holds sculptural scene; left third near-black soft negative space so real HTML headline can sit there. Palette almost black violet #21182e, lavender #c8b5ee, pale violet chalk, tiny coral #f28b7d. No text, typography, logos, watermarks, people, UI mockup or controls. Output a fully finished exceptionally beautiful cinematic artwork, intended as a wide cropped hero with live HTML and motion layered over it.
