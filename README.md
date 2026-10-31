# Meowdiobooks

English | [简体中文](README.zh-CN.md)

<p align="center"><img src="frontend/src/assets/brand/meowdiobooks-social.png" alt="Meowdiobooks — a studio for stories" width="100%"></p>

<p align="center"><strong>Read it. Cast it. Hear it.</strong><br>Personal audiobook production, with every important decision in your hands.</p>

<p align="center"><a href="#run-locally">Get started</a> · <a href="docs/COMMUNITY.md">Our commitment</a> · <a href="https://github.com/PetarKing/meowdiobooks/releases/latest">V1.0 release</a></p>

> **V1.0 · macOS · Apple Silicon** — local audio production with cloud-assisted cleanup. This release
> is for people comfortable installing the documented local model stack and reviewing key
> AI-assisted decisions. Review sends bounded book passages to OpenAI Luna and requires an API key.

**Transform a PDF, EPUB, or text file into a dynamic cast audiobook with an AI-native workflow that keeps you in control.**

Meowdiobooks handles the production work between source and sound: extraction, dialogue attribution,
character reconciliation, voice design or local cloning, chapter rendering and audiobook export. It is built for books that
do not behave like clean scripts, and uses focused AI where interpretation helps without hiding the
source or making every decision on the user's behalf.

## AI-native, human-directed

- **Useful automation, not a black box.** Deterministic processing preserves the source; focused AI
  handles bounded literary decisions instead of rewriting the complete book into a guessed script.
- **Review the decisions that matter.** Uncertain speakers, character relationships, extraction
  warnings and voice choices remain visible and correctable before they reach the final audio.
- **Design or clone voices locally.** Tune Qwen voice traits, or provide a 3–30 second WAV, MP3 or
  FLAC sample. Local speech recognition drafts the sample transcript for correction, and the reviewed
  audio/text pair becomes that character's private, book-scoped voice reference.
- **Local audio, cloud-assisted cleanup.** The application runs on a supported Mac. Review sends
  bounded text passages to OpenAI Luna through the Decisions API and requests correction proposals
  for flagged text. You can keep the original or accept proposals individually or together before
  audio generation. An OpenAI API key is required for this pass; there is no local model fallback.
  Dialogue attribution still offers its separately selected local or remote profile.

## See the workflow

<p align="center">
  <img src="docs/assets/showcase/wizard-transcript-check.jpg" alt="A public-domain Alice in Wonderland PDF beside its speaker-attributed audiobook transcript" width="100%">
</p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/showcase/wizard-extract.jpg" alt="Comparing PDF extraction methods against a public-domain Alice in Wonderland source">
      <br><strong>Keep the source visible.</strong> Compare extraction methods against the original PDF before processing the complete book.
    </td>
    <td width="50%">
      <img src="docs/assets/showcase/wizard-voice-auditions.jpg" alt="Auditioning character voices for a public-domain Alice in Wonderland sample">
      <br><strong>Let AI propose; keep the final say.</strong> Reconcile source labels into a cast, inspect the evidence, then audition and accept each voice.
    </td>
  </tr>
</table>

The screenshots show the V1 interface using public-domain Alice passages and synthetic demonstration
fixtures, with the current forest palette and heart identity. No private books or customer data appear.

<p align="center"><img src="docs/assets/showcase/studio-dark.jpg" alt="The Meowdiobooks V1 studio in its forest dark appearance" width="100%"></p>

## Built for real books

| Messy source example | What Meowdiobooks does |
|---|---|
| `Mara: “Run.”` | Detects source-anchored dialogue without asking a model to rediscover it |
| `Mara unfolded the note. “Do not open it,” she read aloud.` | Focused AI reads the bounded surrounding prose and proposes `Mara` as the speaker for review |
| `???: “You should not have come here.”` | Keeps uncertainty explicit and routes unresolved speech through a reviewed narrator fallback |
| `Dr. Vey: “Stay still.”` … later: `“Breathe,” the doctor said.` | Reconciles reviewed source labels into durable character identities and one consistent voice |
| `LIN & MARA: “Together.”` | Distinguishes groups from individuals and can mix explicit members on one timeline event |
| `The sign read “DO NOT OPEN.”` | Focused AI can mark the quotation as writing rather than speech, keeping it with the narrator |
| `Mara: [Wait— “No,” Lin interrupted.]` | Shows competing claims over the same source range and blocks acceptance instead of silently choosing or dropping text |

The system is deliberately conservative: it does not run an opaque full-book rewrite and call the
result certain. See [current coverage and review boundaries](docs/KNOWN_GENERALIZATION_RISKS.md) for the exact
handling boundaries, including plot-dependent aliases, changing character forms, unusual dialogue
conventions, and extraction limits.

## Hear the result

**[Listen to the demo WAV](docs/demo/meowdiobooks-demo.wav)** ·
[read the one-page source and inspect every transformation](docs/DEMO.md)

The original demo scene includes aliases, an unknown speaker, simultaneous delivery, quoted text that
is not speech, and narrator prose. The walkthrough shows the reviewed artifacts Meowdiobooks uses;
the linked audio was generated from that accepted cast and render plan by the production renderer:

```text
PDF / EPUB / text → source text → dialogue attribution → character reconciliation → voice casting → WAV → M4B / MP3
```

| Source evidence | Accepted result | Audio behavior |
|---|---|---|
| `Mara`, `Dr. Vey`, `the doctor` | one character identity | one consistent voice |
| `???` | unresolved speaker | honest narrator fallback |
| `LIN & MARA: Together.` | explicit group turn | voices mixed on one timeline |
| `She read “DO NOT OPEN”...` | quoted writing, not speech | narrator |

## The rest of the workflow

- Preserves an exact, inspectable chain from PDF ranges to accepted dialogue, identities, voices, and
  render events.
- Detects extraction, coverage, chapter, repeated-matter, page-number, and footnote issues for review.
- Generates comparable character-specific voice auditions and pins the exact accepted revision.
- Supports local voice cloning from an uploaded sample, with automatic language detection, an
  editable transcript draft, and a generated audition of the same line used to compare designed voices.
- Prepares one faithful final recording script from the accepted upstream revisions when Generate first needs it.
- Publishes complete versioned WAV chapters atomically, packages current chapters as M4B or MP3, and keeps completed exports in a local Library.
- Stores source books, accepted work, voice samples and generated audio on your Mac. Voice generation
  runs locally. Review sends bounded passages to OpenAI; optional remote Dialogue also sends scenes
  and evidence excerpts. These excerpts may cover text from anywhere in the book.

After local PDF intake, the guided workflow is **Extract → Dialogue → Review → Cast & Voices →
Generate → Export**. See the
[workflow guide](docs/wizard/README.md) for the exact phase behavior.

## V1 scope

Meowdiobooks supports local PDF, EPUB, UTF-8 TXT, and Markdown files on Apple Silicon Macs.
PDFs can be up to 500 MB; text files up to 20 MiB. EPUB archives are bounded to 2,000 entries,
8 MiB per entry, 64 MiB expanded, and 20 MiB of readable text. PDF extraction,
attribution, identity reconciliation, voice design and cloning, chapter generation, and audiobook export
work. AI results require your review. V1 establishes a supported baseline: preserving your accepted work
and exports is a release requirement. Any future format change must include a documented upgrade
path; keep a backup before upgrading. Model installation remains manual.

**Coming next:** easier setup and review, broader source and hardware support, and measured improvements
to dialogue and audio quality. A hosted companion and richer character-aware listening experience are
planned directions. See the [roadmap](docs/ROADMAP.md).

## Built to remain yours

As long as we offer Meowdiobooks commercially, we commit to maintaining this personal, self-hosted
edition and sharing improvements to the common audiobook workflow. We will not turn it into a
subscription-only shell or require a Meowdiobooks account to use it. Community fixes and improvements
can benefit personal and paying users alike. Read [our support and quality commitment](docs/COMMUNITY.md).

## Models

[`models.toml`](models.toml) is the runtime source of truth; the [model guide](docs/MODELS.md) contains
the pinned revisions, download commands, expected paths and compatibility rules. The complete default
local set is roughly 15 GB.

| Step / use case | Route | Default model | Compatible configuration |
|---|---|---|---|
| Dialogue attribution, cast identity classification and voice suggestions | Local | Qwen3.5 9B Q4_K_M through pinned `llama.cpp` | A registry entry using the supported `llama_cpp` engine and the same validated prompt/output contracts |
| Large Dialogue reviews, when explicitly selected | Remote, optional | `gpt-6-luna` (`service_tier = "fast"`) through the configured OpenAI Responses profile | An OpenAI Responses profile supporting strict JSON schemas, function tools, and the bounded evidence contract |
| Designed voice auditions | Local | [`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) | A compatible MLX-Audio VoiceDesign checkpoint paired with a Base renderer and an explicitly validated language list |
| Voice-sample transcript draft (STT) | Local | [`mlx-community/Qwen3-ASR-0.6B-4bit`](https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-4bit) with automatic language detection | A compatible MLX-Audio Qwen3-ASR checkpoint implementing the same editable text/language result; a future Linux adapter can preserve this boundary |
| Voice-cloned audition | Local | [`mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit) with the uploaded reference WAV and corrected transcript | A compatible Base checkpoint supporting transcript-conditioned `ref_audio` + `ref_text` cloning |
| Chapter generation | Local | The same Qwen3-TTS Base 1.7B 8-bit renderer | The Base half of the selected voice pipeline, supporting every configured book language |

Voice cloning does not use a separate synthesis model: Qwen3-ASR proposes editable words, then the
same Qwen3-TTS Base renderer used for chapters clones the corrected audio/text reference. VoiceDesign,
Base TTS and STT remain local. The optional remote Dialogue route sends bounded scene and evidence
text externally and may inspect any part of the book while resolving a difficult speaker.

A fully local Review adapter is a supported direction for community development, not a V1 feature.
The current Review policy requires `gpt-6-luna` and both Decisions and Responses APIs. Changing
`base_url` to a chat-completions-compatible server alone is insufficient. See
[provider compatibility](docs/COMMUNITY.md#your-models-and-your-data).

## Run locally

Requirements: macOS on Apple Silicon (`arm64`), about 18 GB unified memory, 30 GB free storage, and
roughly 15 GB for the pinned local model assets.
Install the standard development and media dependencies first:

```bash
brew install python@3.12 uv node poppler ffmpeg
npm install --global @llamaindex/liteparse
```

Poppler renders PDF page previews; LiteParse is one of the available extraction methods. FFmpeg
packages generated chapters as M4B or MP3.

```bash
# Clone or download this repository, then:
cd meowdiobooks
npm --prefix frontend ci
npm --prefix frontend run build
uv sync --extra mlx-runtime
uv run meowdiobooks doctor
uv run meowdiobooks serve
```

Before `doctor` can pass, install llama.cpp and the configured local model assets using the
[local-model guide](docs/MODELS.md). They are intentionally not downloaded by the dependency commands.
The `mlx-runtime` extra installs the current Apple Silicon inference packages; future runtime
backends can be added as separate extras without changing the cross-platform application core.
Local voice-sample transcription requires the pinned **Qwen3-ASR 0.6B 4-bit** model at
`models/qwen3_asr_0_6b_4bit/`; the guide includes its exact revision and download command alongside
the text, VoiceDesign and Base TTS models. `doctor` reports it as **Speech recognition** when installed.
Open <http://127.0.0.1:8000> after `serve` starts.
When changing the frontend, use `uv run meowdiobooks dev` to rebuild it once before starting the server.

Only one backend may use a data directory at a time. A second `serve` command exits before reading
or changing job state and reports the PID of the running instance. Restarting the browser is safe;
an active generation remains owned by the original backend process.

## Limitations

- Encrypted PDFs and EPUBs are unsupported. EPUB reading sections must be XHTML; SVG reading
  text, audio, video, objects, and XML entities are rejected. Image-only sections have no spoken
  text; image descriptions are kept when supplied. Markdown is read literally as text.
- EPUB and text imports skip Extract (shown disabled) and open Dialogue. Long passages use
  stable reading sections rather than printed pages; Review keeps the source text visible.
  EPUB spine order includes supplementary sections. Text imports use a default cover or your upload.
- Image-only, malformed, multi-column, or layout-heavy PDFs may extract poorly or fail.
- Dialogue attribution, character reconciliation, and voice design require review.
- Heavy work is serialized for one local user and can take substantially longer than playback.
- Chapter generation can reuse validated checkpoints when accepted inputs and the render recipe
  still match. Other interrupted work may need a retry; recovery never bypasses review.
- There is no installer, updater, authentication, LAN mode, built-in player, or phone connection.
- Meowdiobooks does not bypass DRM. You are solely responsible for ensuring that you have the
  rights and permissions required for every book and output you process, generate, share, or use.
  The project and its contributors do not grant rights to third-party content or accept
  responsibility for unlawful or infringing use.

See [current coverage and review boundaries](docs/KNOWN_GENERALIZATION_RISKS.md) for technical detail.

## Related work

Meowdiobooks specializes in the complete transformation of dialogue-heavy PDFs into reviewable cast
productions: page-aware extraction, source-anchored attribution, explicit uncertainty, identity and
group reconciliation, voice auditions, chapter generation and audiobook export in one guided workflow. Its
current hardware support is focused on Apple Silicon.

Related open-source projects explore a broader audiobook-generation space:

- [ebook2audiobook](https://github.com/DrewThomasson/ebook2audiobook) supports many input and output
  formats, languages, platforms and TTS engines, including OCR and voice-cloning workflows.
- [Alexandria Audiobook Generator](https://github.com/Finrandojin/alexandria-audiobook) provides an
  editable multi-voice studio with LLM script annotation and review, voice cloning and design, and
  selective chunk regeneration across a broader set of GPU environments.

These projects emphasize format, model or editing breadth. Meowdiobooks goes deeper on keeping a raw
PDF inspectable while AI and the user turn it into a coherent cast audiobook.

## Development

```bash
uv run pytest -q
uv run ruff check src/meowdiobooks tests
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
```

Pull-request CI installs only the cross-platform core and skips tests marked
`uses_audio_decoder` or `runs_models`. The complete local suite above remains the release-confidence
check on Apple Silicon.

Substantial contributions without existing maintainer approval should start with an issue describing
user value, scope, affected contracts, test strategy, and dependencies. Existing approval covers its
stated scope. New services, databases, caches, cross-service coupling, or runtime dependencies outside
that scope require maintainer approval before adoption. AI-assisted contributions are
welcome when the author remains accountable and supplies evidence proportional to the change. See
the [contributor reference](docs/CONTRIBUTING.md), including the
[AI-assisted contribution policy](docs/CONTRIBUTING.md#ai-assisted-contributions).

## Documentation

- [Documentation index](docs/README.md)
- [Demo: source to audio](docs/DEMO.md)
- [Setup and model assets](docs/SETUP.md)
- [Local models and configuration](docs/MODELS.md)
- [Local TTS benchmarks and precision comparison](docs/LOCAL_TTS_BENCHMARKS.md)
- [Roadmap](docs/ROADMAP.md)
- [Workflow guide](docs/wizard/README.md)
- [Audiobook export](docs/M4B_EXPORT.md)

## License

Meowdiobooks is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).
You may use, study, modify, and redistribute it for permitted non-commercial purposes. Commercial
use is not licensed. The software is provided as-is, without warranty or liability to the extent
allowed by law.

External Contributions require acceptance of the [Contributor License Agreement](CLA.md), which
permits their use in public and hosted versions while contributors retain ownership.
