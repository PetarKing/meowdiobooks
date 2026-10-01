# Mobile staging fixes

Baseline: merged Core `e89137192435ad496230f8cf3ff1adec9f98ab36` (workflow 0.1.37).
These are reusable workflow changes. The companion Cloud change owns the document
canvas, Safari theme colour, and compact help footer. No vendor files, dependencies,
accepted artifacts, persisted audition bindings, or backend contracts were changed.

## Findings and resulting behaviour

- **Language selection:** mobile WebKit reproduced the original disclosure closing on
  focus loss before the option's click; French remained unselected. The replacement
  native selector is 48px tall with 16px text. It handles empty catalogs and explicitly
  displays an unavailable saved language instead of silently rewriting saved auditions.
- **First casting visit:** a new draft now chooses an offered model and supported
  language. Existing accepted auditions and matching interrupted jobs retain their
  exact model/language bindings. Model choices remain available when the first quote
  fails. A 422 validation message is displayed; generic server errors retain generic
  copy. Continue requires the matching successful quote, including immediately after
  a language change and during retries. Failed or superseded requests cannot approve it.
- **PDF selection:** a compact receipt replaces the oversized book-shaped panel.
  Its 44px replacement control opens the file picker directly; cancellation retains
  the selected file.
- **AI scopes:** tapping the heading, count, or description toggles the checkbox.
  Opening Example does not toggle it. Zero-count scopes say "None found" without an
  unusable checkbox. No selected scopes uses Narrator without requiring an AI route.
- **Navigation:** changing the wizard step or cast phase resets document scroll and
  focuses the main region. Snapshot refreshes and clicking the current step do not.
  The main region has no decorative focus outline; control focus rings remain visible.
- **Library spacing:** a 1160px reading width keeps wide-screen editions together,
  while fluid 84–120px covers leave more room for phone titles. Tablet actions remain
  beside their book details, and phone actions use a full-width row. The two-column
  threshold, header spacing, and long author names no longer produce awkward gaps.
  Cast and Voices styles and Library content/actions retain their existing design.

## Executed checks

| Check | Result |
| --- | --- |
| `npm --prefix frontend test` | 29 files, 297 tests passed |
| `npm --prefix frontend run build` | Passed; existing bundle-size warning |
| `npm --prefix frontend run lint` | Passed; existing LanguagePicker fast-refresh warning, zero errors |
| `npm --prefix frontend run storybook:check` | Passed |
| `npm --prefix frontend run test:consumer` | Packed source, host TypeScript, primitive and App header overrides passed |
| `PYTHONPATH=src python -m pytest tests/backend/test_dialogue_v2.py tests/backend/test_dialogue_ai.py -q` | 41 dialogue + 30 attribution tests passed, run separately |
| Backend suite excluding model/decoder execution; Ruff | 483 passed, 3 deselected; lint passed |
| `python docs/mobile-staging-fixes/verify-narrator-samples.py` | All three public-domain PDFs passed |
| `git diff --check` | Passed |

Chromium and WebKit touch emulation at 320px and 390px exercised file replacement,
cancellation, scope-row taps, independent examples, and the actual App's zero-target
submission. No product overflow or page errors occurred. The developer-only Studio
scenario toolbar has an existing WebKit intrinsic-width overflow at 320px and was
hidden for product measurements; it is absent from the full-App fixture.

The independent WebKit full-App check used 60 synthetic cast identities. Scrolling
6315px down the cast and opening voice design reset scroll to zero and focused main.
Both a successful first quote and a first-request 422 recovered through native French
selection to a matching successful quote. Continue disabled immediately on selection
change and enabled only after that quote. No process/provider methods were called.
The source hashes and observations are in
[casting-full-app-mobile-webkit.json](evidence/casting-full-app-mobile-webkit.json).

The public sample comparison covers 49, 32, and 12 detected dialogue spans respectively.
Empty-scope `fill-gaps` and explicit `narrate` produce identical source reconstruction,
spoken text, source labels, and fallback routing. These excerpts contain no literal
explicit-label spans; preservation of known labels is covered by the backend and App
tests. This is an opt-out routing comparison, not a rerun of local/remote AI attribution
quality or audio listening. No extraction or inference implementation changed.

## Reproduction and inspectable evidence

Run Vite on 127.0.0.1:5182 from `frontend`, then from the repository root:

```sh
node docs/mobile-staging-fixes/verify-home-dialogue-mobile.mjs chromium
node docs/mobile-staging-fixes/verify-home-dialogue-mobile.mjs webkit
node docs/mobile-staging-fixes/verify-casting-mobile.mjs
python docs/mobile-staging-fixes/verify-narrator-samples.py
```

The casting script serves its own temporary local fixture and closes it afterward.
Use the repository Python environment for the sample check. Browser scripts require
the Playwright Chromium and WebKit runtimes installed for the locked version.

- [Original versus native language interaction](evidence/language-evidence.md)
- [Compact PDF receipt](evidence/webkit-import-selected-390.png)
- [Zero-target dialogue state](evidence/webkit-dialogue-zero-targets-390.png)
- [First casting visit](evidence/casting-first-visit-mobile-webkit.png)
- [Selected narration language](evidence/casting-selected-language-mobile-webkit.png)
- [Public sample comparison](evidence/narrator-sample-comparison.json)
- [Responsive Library proof](library/README.md)

All attached evidence uses synthetic fixtures or the repository's public-domain sample
set. WebKit emulation is not physical iPhone Safari verification. The initial remote
422's rejected field remains unknown because staging access logs do not contain request
settings or response details. No staging deployment, customer mutation, paid inference,
release publication, or Cloud pin upgrade is included in this change. Adoption requires
the normal immutable Core release and Cloud pin flow.
