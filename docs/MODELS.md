# Model setup

Meowdiobooks does not download or update AI runtimes or model weights automatically. Model downloads
are large, and users should be able to review their source, license, revision and destination first.
The complete default set uses roughly 14 GB.

The checked-in [`models.toml`](../models.toml) is the runtime source of truth. Paths may be absolute,
home-relative (`~/...`) or relative to the repository root. The default entries preserve the models
used to develop and verify the alpha.

## What runs what

| Work | Runtime | Lifecycle |
|---|---|---|
| Dialogue speaker decisions | Qwen3.5 GGUF locally, or the configured OpenAI-compatible remote model when explicitly selected | Local processing starts and stops `llama-server`; remote processing sends only the selected source passages |
| Cast and optional Enrichment text decisions | Qwen3.5 GGUF through `llama.cpp` | Meowdiobooks starts `llama-server` for the operation and stops it afterward |
| Voice auditions | Qwen3-TTS VoiceDesign through MLX-Audio | Loaded inside the Python process for the audition job |
| Chapter audio | Qwen3-TTS Base through MLX-Audio | Loaded inside the Python process for the generation job |
| Voice-sample transcript draft | Qwen3-ASR 0.6B 4-bit through MLX-Audio | Loaded for one draft, with automatic language detection, then released |

Do not start `llama-server` separately. MLX-Audio is installed by `uv sync`; llama.cpp and all model
weights are user-managed assets.

## Install the tested defaults

These commands use a temporary `uvx` tool environment for Hugging Face downloads. They do not add a
Hugging Face client to Meowdiobooks' runtime dependencies.

```bash
mkdir -p .local/models/qwen35-9b
uvx --from "huggingface-hub[hf_xet]" hf download \
  bartowski/Qwen_Qwen3.5-9B-GGUF \
  Qwen_Qwen3.5-9B-Q4_K_M.gguf \
  --revision e3abf1f4e3c6cf7c24bf1dd17ec327cd66ba4e76 \
  --local-dir .local/models/qwen35-9b

uvx --from "huggingface-hub[hf_xet]" hf download \
  mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16 \
  --revision 7d3824abff87e49756bb0f83fb5411de75d160c4 \
  --local-dir models/qwen_1_7b_voice_design

uvx --from "huggingface-hub[hf_xet]" hf download \
  mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit \
  --revision 37e955a1deb861c088ae5f3a67043185f3d1a60c \
  --local-dir models/qwen_1_7b_base_4bit

uvx --from "huggingface-hub[hf_xet]" hf download \
  mlx-community/Qwen3-ASR-0.6B-4bit \
  --revision 313d850181767edf09f00a9c289becca70e58cd0 \
  --local-dir models/qwen3_asr_0_6b_4bit
```

Download the Apple Silicon archive for [`llama.cpp` b9637](https://github.com/ggml-org/llama.cpp/releases/tag/b9637).
Its published archive is `llama-b9637-bin-macos-arm64.tar.gz`, with SHA-256:

```text
72a93f3e68c31de3e438d462669aad1fcdb423b995e9c41033cc7d27a9a3ac69
```

Extract the release and place its executable and accompanying dynamic libraries under:

```text
.local/llama.cpp/b9637/
```

The configured executable must then exist at `.local/llama.cpp/b9637/llama-server`. Alternatively,
install a compatible llama.cpp build yourself and change `runtime_path` in `models.toml` to its
absolute executable path. Build compatibility can affect prompts and output contracts; run the full
test suite before treating a different build as supported.

## Verify setup

```bash
uv run meowdiobooks doctor
```

`doctor` is read-only. It checks the host, standard executables, frontend build, configured paths,
model metadata, all configured voice languages, free storage and unified memory. It does not download,
move or modify anything.

## Configure compatible models

All text calls use the single model selected by `defaults.text`. Additional text models may be listed
under `text_models`, but the UI deliberately does not expose a text-model selector.

Each `voice_pipelines` entry is one user-selectable pair:

- `audition_path` creates the reference performance;
- `renderer_path` renders chapters from that accepted reference;
- `languages` controls the existing Voice model and Book language controls in Cast & Voices.

Adding a second voice pipeline automatically adds it to the existing selector; no frontend changes
are required. A configured language must be supported by both installed model configurations.

`defaults.transcription` selects one `speech_models` entry. The current macOS adapter uses MLX-Audio;
the backend exposes the same narrow draft-transcription contract to the frontend so a future Linux
adapter can replace the engine without changing the voice-sample workflow or artifact format.

Configuration is not a generic plugin system. The current engines are intentionally limited to local
`llama_cpp`, OpenAI-compatible Chat Completions or Responses remote text models, and `mlx_audio`
Qwen3-TTS pipelines that honor the existing contracts. Unknown engines fail configuration validation.

## Optional remote Dialogue model

For large speaker reviews, Dialogue can offer the configured `remote_profile` alongside the local
model. Remote profiles live under `remote_text_models` in `models.toml`; the API credential remains in
the environment variable named by `api_key_env` and is never written to an artifact or sent to the
browser. Display names, provider domain, estimated per-target cost, and benchmark comparison all come
from the same model registry.

The current remote policy runs two differently framed ordered-passage checks. A Character name is
kept only when both checks agree exactly and the name appears in the supplied passage. Provider,
transport, parsing, or agreement failures never silently fall back to a weaker Character guess.
When the checks disagree but return one or more context-supported names, the turn stays with the
narrator and those names are preserved only as review suggestions.
