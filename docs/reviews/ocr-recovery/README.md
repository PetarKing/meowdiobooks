# Per-page OCR recovery verification

Standard remains recommended and never proactively OCRs a book. A text/image
metadata scan identifies sparse raster pages; Review shows each original page
before its independent confirmation or targeted OCR recovery.

The synthetic browser scenario `review-missing-pages` shows physical page 7,
its original image, and both actions on desktop and phone. The interaction test
in `App.test.tsx` confirms page 7 independently, moves to physical page 115,
recovers only page 115, displays the frozen candidate against the original image
without a second OCR request, and requires explicit acceptance.

![Phone](phone-light.png)

![Desktop](desktop-light.png)

Validation on macOS arm64, Python 3.12 / Node 22:

- `PYTHONPATH=src python -m pytest -q -m 'not uses_audio_decoder and not runs_models'`: 1,653 passed, 3 deselected.
- `python -m ruff check src/meowdiobooks tests`: passed.
- `python scripts/check_publication.py`: passed.
- `npm --prefix frontend test`: 625 passed.
- `npm --prefix frontend run lint`: no errors; two pre-existing refresh warnings.
- `npm --prefix frontend run build` and `storybook:check`: passed.
- `npm --prefix frontend run test-storybook`: 103 passed.
- `npm --prefix frontend run build-storybook`: passed.
- `npm --prefix frontend run test:consumer`: passed.
- `npm --prefix frontend run visual:review -- /tmp/ocr-visual-review`: 104 scenarios passed across desktop/phone and light/dark; no overflow, browser errors or accessibility violations.

The three public-domain evaluation PDFs preserve the same Standard page text as
the baseline: Alice 4 pages/4,455 characters; Pride 4/4,924; Ah Q 2/1,339. OCR-enabled
reading of those digital PDFs preserves the same text after outer whitespace
normalization. Synthetic tests cover footer-only raster pages, empty layout
fragments, independent page confirmations, failed/unchanged OCR, stale repair
bases, unchanged-page preservation, publication/invalidation, concurrent caches,
corrupt optional metadata, and incomplete extraction rejection.

This is native macOS evidence. Hosted CI, consumer release publication and
deployment are separate gates; no Linux-equivalence claim is made here.
