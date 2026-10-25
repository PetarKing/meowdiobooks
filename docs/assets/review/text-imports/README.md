# EPUB and text import verification — 2026-10-25

The shared reader accepts EPUB, UTF-8 TXT and literal Markdown. Import prepares and accepts
source text automatically; Extract is disabled with “Not needed”, and the workflow opens Dialogue.
Review displays inert source text. Export supports a generated cover or an uploaded image.

## Automated evidence

Run from the repository root with locked development dependencies installed:

```sh
PYTHONPATH=src .venv/bin/pytest -q -m 'not uses_audio_decoder and not runs_models'
PYTHONPATH=src .venv/bin/ruff check src/meowdiobooks tests
python3 scripts/check_publication.py
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run storybook:check
```

The new security suite exercises hostile paths, XML entities at every EPUB XML boundary,
ZIP expansion/directory limits (including ZIP64 overrides and forged entry counts), corrupt
compression, repeated resources, unsupported embedded content, UTF-8 and binary rejection.
Independent workflow tests cover source preservation, spine order, automatic acceptance, duplicates,
restarts, host processor routing, failure rollback/retry, Dialogue→Review, and default/custom covers
for all three formats. Export packaging is stubbed; these tests do not claim audio codec verification.

Real-book compatibility: both EPUB editions of [Project Gutenberg’s Alice](https://www.gutenberg.org/ebooks/11)
were downloaded into temporary storage and parsed successfully, including their image-only SVG cover
wrappers. Those wrappers are skipped without rendering or loading resources; SVG reading text remains
unsupported. Both editions preserve the title and author and produce 34 source sections.

| Edition | Source SHA-256 | Extracted characters |
|---|---|---:|
| EPUB 3 | `4f81245d31380ac1d6eafb9a321e3691369bc70985736ae4bccf849a4f784036` | 164349 |
| EPUB 2 | `e332bfce56f79897138d73e7b698dc59bd073d932acb87897606aa7b5df96dac` | 164441 |

## Browser evidence

Using the production frontend and real local API, upload a synthetic `.txt`, `.md`, and `.epub`;
verify Extract is disabled, Dialogue is active, and reload preserves that state. All three passed
in headless Chrome on macOS at 1440×1000 and 390×844, without page errors. The EPUB contains two
XHTML sections whose ZIP ordering differs from its spine. No models or external providers were called.

[Desktop](desktop.png) · [Mobile](mobile.png)

The mobile image is a fresh mobile viewport capture. Resizing a desktop page then capturing a
full page initially duplicated sticky chrome in the capture; DOM inspection and fresh viewport/full-page
captures confirmed one application header and one workflow navigation.

## PDF regression comparison

Native extraction was compared with `origin/main` at `e916475` using separate cache directories.
All text was identical, including the Chinese sample.

| Public-domain sample | Pages | Characters | Extracted-text SHA-256 |
|---|---:|---:|---|
| Alice | 4 | 4758 | `e72d9283aab8b936e849b14fbbea2e7c4315dff3ef27e038b17be7793e5b63bd` |
| Pride and Prejudice | 4 | 5146 | `f0f1e36b1b6c7ba0b223b9dd98d567545c88a756484c58ffdf332f98867d0a27` |
| Ah Q | 2 | 1438 | `23b63c7435c197f142a01745e58ece9ce100058c31e03b48896da4568c65708e` |

This checks extraction preservation, not model attribution or listening quality. No generated user
books, credentials, or private hosted configuration are included in this evidence.
