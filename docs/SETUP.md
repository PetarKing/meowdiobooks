# Setup reference

Meowdiobooks V1 supports macOS on Apple Silicon (`arm64`) only.

## Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js and npm
- Poppler (`pdftoppm`) for PDF page previews
- LiteParse for the LiteParse extraction option
- FFmpeg for audiobook export
- At least 18 GB unified memory and roughly 30 GB free storage recommended
- Approximately 15 GB for the pinned local language, voice and speech-recognition models
- An OpenAI API key with access to `gpt-6-luna`, the Decisions API, and Responses for cleanup Review

Set `OPENAI_API_KEY` in the process environment (or an ignored local `.env` file) before starting the
app. Review sends bounded passages to OpenAI and presents correction proposals for your approval.
It cannot run this pass offline and does not fall back to a local decision model. See
[cleanup review](CLEANUP-REVIEW.md). Never commit credentials or copy a hosted operator key into a
public checkout.

## Install standard dependencies

```bash
brew install python@3.12 uv node poppler ffmpeg
npm install --global @llamaindex/liteparse
```

Meowdiobooks does not install system packages or change Homebrew/npm state. The commands above are the
tested Apple Silicon setup; users who already manage these tools elsewhere may use compatible paths.

## OCR for image text

Standard, Embedded text and Complex layout read the PDF's saved text. The explicit
OCR option also recognizes printed English text in images using LiteParse's
bundled Tesseract engine. Compare its preview for recognition mistakes before
processing a complete book. English OCR does not imply scanned-language support
for every language the ordinary text extractor can read.

Tesseract needs English language data. LiteParse can download it on first use;
prepare it before offline use. Restricted hosts must provision and grant access
to language data outside the document parser instead of allowing parser network
access. See [LiteParse's OCR guide](https://github.com/run-llama/liteparse/blob/main/docs/src/content/docs/liteparse/guides/ocr.md).

Standard remains the recommended method. A cheap scan of the complete PDF's
native text and raster coverage selects up to two sparse-text image pages for
inspection and flags all such pages for Review, including footer-only extraction.
It does not run OCR. Blank digital pages do not qualify; an illustration or blank
scan can qualify because metadata cannot establish whether it contains useful text.

Review shows each suspect original page. Choose **Recover this page with OCR**
to create an unpublished extraction candidate for that physical page only. Compare
it before accepting. Untouched pages retain their saved extraction; acceptance
rebuilds source blocks and invalidates Dialogue and Review (and later work).
A blank or unchanged OCR result leaves the accepted extraction intact. Confirming
an intentionally blank or visual-only page applies to that page only.

The separate OCR extraction option can read an entire scanned book when explicitly
selected. No whole-book OCR runs proactively.

## Model assets

V1 deliberately does not install AI runtimes or model weights automatically. The default
[`models.toml`](../models.toml) expects these assets relative to the repository root:

| Purpose | Asset | Expected path |
|---|---|---|
| Document analysis | Qwen3.5 9B Q4_K_M | `.local/models/qwen35-9b/Qwen_Qwen3.5-9B-Q4_K_M.gguf` |
| Local LLM runtime | llama.cpp b9637 | `.local/llama.cpp/b9637/llama-server` |
| Voice auditions | Qwen3-TTS VoiceDesign 1.7B | `models/qwen_1_7b_voice_design/` |
| Chapter rendering | Qwen3-TTS Base 1.7B 8-bit | `models/qwen_1_7b_base_8bit/` |
| Voice-sample transcript drafts | Qwen3-ASR 0.6B 4-bit | `models/qwen3_asr_0_6b_4bit/` |

Model and runtime directories are ignored by Git. Follow the [local-model guide](MODELS.md) for exact
sources, pinned revisions, download commands, llama.cpp setup, compatible replacements and language
validation.

## Install and run

```bash
npm --prefix frontend ci
npm --prefix frontend run build
uv sync --extra mlx-runtime
uv run meowdiobooks doctor
uv run meowdiobooks serve
```

`doctor` reports every missing dependency or asset and changes nothing. Once it passes, start the app
and open <http://127.0.0.1:8000>. The server binds to localhost by default.

During frontend development, use `uv run meowdiobooks dev` to run the locked frontend install and
build once before starting the backend. It is the short form of
`uv run meowdiobooks serve --rebuild-frontend`; both are available only from a source checkout, and
ordinary `serve` never rebuilds the frontend.

The base project dependencies are cross-platform. `mlx-runtime` selects the current Apple Silicon
inference backend; it does not download llama.cpp or any model weights. The supported application setup is the source-checkout installation above; no public package
registry installation is documented. The separately published `meowdiobooks-workflow` wheel is an
integration asset, not the complete local application or its Apple Silicon runtime. See
[shared release assets](../release/README.md) for its scope.

## Repository branding assets

The README uses `frontend/src/assets/brand/meowdiobooks-icon-512.png`. For a GitHub
repository social preview, upload `frontend/src/assets/brand/meowdiobooks-social.png`
in the repository General settings. The browser uses `frontend/public/favicon.svg`,
whose larger heart is designed for small sizes. These assets contain no subtitle.
