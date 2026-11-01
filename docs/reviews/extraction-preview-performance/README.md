# Extraction preview responsiveness

Opening Extract starts only page 1, alongside the fixed sample navigation. Selecting
another page updates the heading and selection immediately. The original page loads
independently while text/OCR remains pending; loaded and in-flight previews are reused
by book, method and page. Failed requests can retry, and stale results cannot replace
the current selection. Redundant extraction information controls were removed.

## Verification

- Backend: 1,753 passed, one optional skip, three audio/model tests deselected; Ruff
  and publication hygiene passed on macOS/Python 3.12.
- Frontend: 644 tests passed; build and Storybook types passed. ESLint retains two
  existing refresh warnings.
- Real hosted sandbox: page screening, native text, raster OCR and missing-model
  failure test passed with the updated Core source.
- Independent backend and frontend reviews found no blockers. Four concurrent real
  renders produced complete PNGs with no pending cache files left over.
- The three bundled public-domain English/Chinese PDFs retained byte-identical text
  hashes before/after and triggered zero OCR calls. A 248-page synthetic PDF preview
  screened only requested page 124. Complete screening still found image pages
  99, 124 and 229; a separate physical-page 1101 check also passed.

Screenshots show production App components with synthetic/public-domain fixtures and
intentionally delayed preview responses, not a claim about model inference speed.
The browser checks ran at 1440px and 390px, in light and dark appearances. They
selected page 24 then page 76, resolved older requests late, and revisited page 24.
Only pages 1, 24 and 76 were requested; revisiting a loaded page made no new request.
The source image appeared before OCR text, and processing the book remained available.

- `desktop-pending.png`: original page visible while extracted text is pending.
- `phone-page.png`: immediate sample selection and original page on a phone.
- `phone-pending.png`: phone text skeleton and available process action.

Full-book automatic OCR recovery remains in Extraction before Dialogue and Review.
