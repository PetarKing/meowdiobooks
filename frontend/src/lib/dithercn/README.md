# dithercn source installation

Upstream: https://github.com/opencoredev/dithercn
Exact commit: `10d7af5ce9b044e82345ae89bf78631845810821` (MIT; LICENSE retained).

This is the actual DitherShader engine and its required modules, plus the upstream Waves example
in `../../components/dithercn/Waves.tsx`. dithercn distributes plain source through shadcn.
The shader, field, motion hooks, WebGL context management and resize logic are upstream code.

Integration adjustments: repository aliases become relative imports; `.toSorted()` becomes
`.sort()` on a newly allocated Object.keys array for our ES2022 target; the one string-only
`cn` call uses a local join helper. Our scoped CSS supplies the small subset of Tailwind layout,
canvas, fallback and transition utilities that the engine renders, without adding Tailwind or
shadcn to the product. Theme changes remount this decorative shader within the existing theme
boundary; no authentication or workflow state is involved.
The Waves example also marks its intentionally omitted `_variant` and `_horizon` values as used
to satisfy this repository's ESLint configuration.

The Home adapter caps the engine at 20fps and 3px cells, uses one context and imports it lazily.
Hidden-tab, offscreen and reduced-motion behavior remains the upstream implementation. A static
CSS fallback remains available without WebGL. The comparison's custom SVG uses no shader.
