# Artwork and fixture provenance

Runtime artwork is decorative; labels, controls, source evidence and acceptance state remain live
HTML. Generated illustration provenance is recorded below. The code license does not grant rights
to third-party books, model weights or voice samples.

## Existing brand assets

The reading-cat mark (`frontend/src/assets/brand/meowdiobooks-mark.png` and its lossless WebP),
hero PNG, workflow-cat PNG and favicon predate the illustration records below. Their original
creation and redistribution authorization must be confirmed by the maintainer before public
publication; these records do not establish their origin. The showcase images use the documented
public-domain Alice fixture. The hero PNG also appears in `docs/assets/`.

## Evaluation and demonstration

The three typeset PDF fixtures have source attribution and jurisdiction qualifications in the
[evaluation README](../SampleBooks/public-domain-evaluation/README.md). The
[demo scene and generated audio](DEMO.md) are an original repository-owned example.
`frontend/stories/fixtures/alice-source-page-1.png` is a Poppler rasterization of page 1 of
`SampleBooks/public-domain-evaluation/01-alice-explicit-dialogue.pdf`, retained for browser layout
checks. It carries the same source attribution as that PDF.

## Generated illustrations

### Sanctuary illustration

Generated with the built-in imagegen tool using the existing Meowdiobooks cat mark as the identity reference. The UI uses `frontend/src/assets/brand/matcha-kami-sanctuary.webp`, encoded with cwebp at quality 88 without changing the composition or dimensions. This is an imagined sanctuary, not a depiction of a real shrine.

```
Use case: stylized-concept.
Asset type: landscape hero illustration for Meowdiobooks, a Japanese-inspired maximalist audiobook studio.
Primary request: glorify the existing orange tabby reading cat mascot as a benevolent local kami presiding over a magnificent sanctuary of stories.
Input image 1 is the identity reference: preserve its orange tabby fur, round dark glasses, large kind eyes, cream paws, and open book. Do not copy its purple color scheme.
Scene: a lavish imaginary Japanese shrine precinct, imposing layered green tiled roofs with sweeping eaves, carved timber brackets, pale washi hanging panels, moss gardens, cherry-red lacquer columns and stone lanterns. A monumental yet friendly cat kami sits on a raised central dais reading an open book; ceremonial rope and paper streamers frame the roof rather than clothing the cat. Tiered architecture and drifting stylized cloud ribbons, tiny cherry blossom details, subtle engraved sound-wave motifs on the book. No humans.
Style: exquisite illustrated architectural fantasy, intricate modern woodblock-print inspired linework and flat painterly gouache texture, premium collectible book-jacket finish. Dense considered ornament, magnificent scale, not a generic cartoon.
Composition: wide landscape 3:2, temple and cat filling the composition, central cat visible clearly at medium size, distinctive roof silhouettes, atmospheric depth. Artwork will have no text over it and be cropped slightly at side edges.
Color palette: matcha #A5B779, deep moss #2D3825, rice-paper #F1F2E8, cherry lacquer #A42F4D and small rose #E6BBC8 accents. Almost entirely these hues; orange cat identity remains recognizable. Daylight muted green atmosphere, no navy/purple night sky.
Constraints: no text, lettering, logos, watermark, UI, hex codes, montage, photorealism, neon, generic pagoda clip art. Richness through craftsmanship and composition.
```

### Sanctuary canopy

`frontend/src/assets/brand/sanctuary-canopy.webp` is an original decorative illustration generated with the built-in imagegen tool for the application. The tool produced a 1536 × 1024 transparent PNG; the selected output was converted with `cwebp -q 84 -m 6 -alpha_q 100` to a 292 KB WebP while retaining transparency. It depicts imagined pine, cherry blossoms and lanterns, without text, a named shrine or religious emblem. The existing reading-cat mark and sanctuary illustration remain the product's identity.

Prompt: “Create one premium decorative bitmap asset for a Japanese-inspired fantasy audiobook studio UI. A cutout ornamental upper-right corner canopy: hand-painted deep olive pine needles and soft matcha leaves arch inward from the top right, interwoven with cherry blossoms in blush pink and wine red; two tiny warm-gold paper lanterns nestled in the foliage and a few loose petals drifting down toward the lower left. Exquisite illustrated book-cover detail, subtle gold ink accents, luminous but restrained, stylistically compatible with an opulent illustrated temple garden and a whimsical orange reading-cat mascot. Keep the majority of the bottom and left empty/transparent so the art can sit behind UI with no content obscured. No cat, no shrine symbol, no lettering, no words, no border, no scene background, no rectangular vignette. Actual transparent background, clean alpha edges. Wide landscape corner composition.”

`styles/atmosphere.css` places it as a washed-out background at the upper right of canonical working stages. It carries no labels or hit targets. A slow, 8–10px position sway is decorative; `prefers-reduced-motion: reduce` stops it. A custom `PresentationRoot` semantic palette marks its visual root and excludes the fixed-color artwork. The canvas/color variables still come from the host. Reproduce appearance and layout checks with the production Storybook fixtures.

## Heart brand identity — 31 October 2026

Owner-selected design: capital-M Meowdiobooks wordmark, heart replacing the i dot,
no subtitle; compact serif M with a heart, in Matcha & Cherry colours. The owner
selected this option in the local logo exploration. Letter outlines derive from
Iowan Old Style Roman installed on the design Mac, shaped with CoreText. No font
file is redistributed. Heart geometry is authored vector artwork. SVG masters live
in frontend/src/assets/brand; BrandMark renders the outlined geometry using presentation colours; the on-screen
wordmark uses native text rendering for smooth fine strokes at UI sizes and follows
the existing serif fallback stack on devices without Iowan. The evergreen icon tile retains cream lettering and a pink
heart in both appearances. PNG outputs are browser-rasterized copies of these SVGs.
The bundled 600×800 default cover is shared by preview/export rendering. New default
covers use cache version v2; existing exports and custom covers are preserved.
