# Matcha & Cherry Sanctuary — local review candidate

The user selected Matcha & Cherry on 2026-09-27 and asked for Japanese-inspired maximalism: impressive temple architecture and the existing reading cat as a local kami. The candidate implements this in the real shared frontend source. It is locally reviewable at http://127.0.0.1:5179/studio.html, using synthetic data; it has not been merged, deployed or aesthetically accepted.

## Design decision

A painted-screen home composition pairs live import controls with an imagined grand sanctuary. The generated illustration preserves the orange tabby, round glasses, cream paws and open book. Moss gardens, layered roofs, cherry lacquer, washi panels and ceremonial architectural details supply richness. Fine double borders, arched seals, brass rules and paper texture connect the shell to the artwork. Work screens use quieter framing to preserve source readability and action hierarchy. Both light and dark modes use the selected green/cherry family.

The reference cat mark stays unchanged. `PresentationRoot`, semantic host overrides, ordinary stylesheet precedence, gateway methods, edition translations and workflow behavior remain intact. The bitmap belongs to the home composition, not neutral controls. The stage rail carries a small framed cat crest; Library cover panels use a fine brass border and restrained wave pattern. The illustration has a finite hover response, suppressed with reduced motion. Home no longer mounts the old GPU sculpture. Art generation is documented in [ART-PROMPT.md](ART-PROMPT.md).

## Executed validation

- `npm --prefix frontend test -- --run`: 24 files, 243 tests passed.
- `npm --prefix frontend run build`: passed. WebP is 539,118 bytes at 1536×1024, reduced from the original 3,525,354-byte PNG. Existing JavaScript bundle-size warning remains.
- `npm --prefix frontend run lint`: zero errors; existing LanguagePicker fast-refresh warning remains.
- `node scripts/verify-host-consumer.mjs` from frontend: packed candidate compiles externally; ordinary host rules override both standalone primitives and App header controls, including hover. The canonical-color assertion now expects the selected cherry value.
- `node scripts/verify-appearance.mjs`: computed light/dark control, status, warning and source contrast pairs all exceed 4.5:1. [Measurements](evidence/appearance.json).
- `node scripts/review-preview.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-sanctuary/evidence`: home at 1440,390,320 in both appearances. Art decoded and visible, no overflow/runtime errors or real API calls; staged file receipt/change-file control and persisted appearance passed. [Results](evidence/preview.json).
- [Independent rendered review](evidence/independent/REVIEW.md): 16 home/library/voice-inspector/recovery desktop/phone states; zero axe violations, page overflow, runtime errors, broken images or real API calls. Includes lower inspector controls and final optimized-asset captures.
- Existing 200% text-enlargement check: eight home/review/inspector/long-generation captures, no runtime errors or real API calls, no document overflow. Inspector has no clipping candidates. The other views retain intentional hidden labels, clipped decorative cat-mark bounds, and book-title ellipsis. This is synthetic text enlargement, not native zoom or an accessibility certification. [Record](evidence/text-enlargement/report.json).

- Follow-up unit and Storybook type checks passed after the rail and Library refinements: 243 unit tests, and `storybook:check`.
- `npm --prefix frontend run test-storybook`: all 57 real-browser interaction/accessibility tests passed. Color-specific Presentation story assertions now match the chosen palette; host override expectations remain independent.
- Focused component/composition/presentation/routing review: 68 desktop/phone light/dark renders, 17 story interaction tests, and 16 explicit sibling/open-dialog checks passed. See `evidence/components/`. The visual review still found a crowded phone sibling story; its status controls were wrapped with spacing and its error note became a block. Independent focused recheck of all four corrected sibling renders passed, and visual inspection confirmed no remaining overlap. Final evidence is under `evidence/components/siblings-after/`.
- `verify-preview-locales.mjs`: all 40 manual preview states and reload entered with persisted Chinese; zero API calls and runtime errors. See `evidence/preview-locales/report.json`.
- `verify-system-appearance.mjs`: eight System/explicit transitions and reload passed with current settled green surface and text colors. See `evidence/system-appearance/report.json`.
- `build-storybook` passed, establishing an exportable source-based component review surface. Its existing bundle-size warnings remain.
- Eight final Library/cast desktop/phone framing captures have zero runtime errors and overflow; inspected Library wave panels and rail cat crest remain clear. See `evidence/final-framing/`.
- Four current synthetic interaction recordings passed: appearance/persistence, required layered voices, saved-audio failure/retry visibility, and description selection with explicit audition approval. No real API calls or runtime errors. [Recording receipt](clips/report.json). The clips contain silent synthetic audio.
- [Source hashes](evidence/source.json) identify the working-tree files; earlier commit hashes alone must not be used to claim these new checks covered that commit.

These checks establish local presentation, synthetic control wiring and consumer compatibility. They do not establish real backend PDF parsing, provider generation, production adoption or user aesthetic approval.
