# Qwen voice quality and uploaded-reference review

Reviewed: 2026-07-16; default checkpoint decision updated 2026-10-25

## Outcome

Meowdiobooks uses the model family in the intended two-step configuration:

1. Qwen3-TTS VoiceDesign creates a short reviewed reference clip from text plus a natural-language
   instruction.
2. Qwen3-TTS Base renders book text by cloning the accepted reference clip and its exact matching
   transcript. Uploaded samples use the transcript entered by the user.

This matches Qwen's documented “Voice Design then Clone” workflow. The main product limitation is that
the editable settings are not hard synthesis parameters. They influence VoiceDesign once; chapter
rendering receives only the resulting audio and transcript. Consequently, timbre usually transfers
better than pace, energy, accent or emotion, which Base may adapt to the new text.

Primary sources:

- [Qwen3-TTS official README](https://github.com/QwenLM/Qwen3-TTS/blob/main/README.md)
- [Qwen3-TTS official model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
- [MLX-Audio Qwen3-TTS runtime guide](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md)
- [Qwen3-ASR official repository](https://github.com/QwenLM/Qwen3-ASR)
- [MLX-Audio speech runtime](https://github.com/Blaizzy/mlx-audio)

## Corrections applied

- The primary VoiceDesign and Base requests now use Qwen's checkpoint defaults: temperature `0.9`,
  top-k `50`, top-p `1.0`, and repetition penalty `1.05`. Cooler requests remain failure recovery
  only. Qwen reports its evaluations with checkpoint defaults and bf16 weights.
- Editable controls now compile into short natural sentences: voice identity, delivery, accent, then
  optional performance direction. Fixed traits explicitly win over contradictory additional notes.
- Regression tests pin the primary sampling contract for both audition generation and cloning.

## Remaining quality work

### 1. Base quantization follow-up

The complete [local TTS benchmark report](LOCAL_TTS_BENCHMARKS.md) records all tested alternatives,
both listening rounds, exact pins, timings and limitations.

The default is now Base 1.7B eight-bit, pinned in `models.toml`; VoiceDesign remains BF16.
A controlled English listening screen compared four-bit, eight-bit and BF16 Base with identical
references, text and synthesis settings. The two-voice follow-up supported eight-bit as the practical
quality/performance choice: similar elapsed generation time to four-bit, while BF16 took roughly
twice as long. This small screen does not establish superiority for every voice, language or book.
Keep longer-book and multilingual consistency in the evaluation backlog.

Adoption verification (2026-10-25): 35 model-registry, audio, language and render-plan tests passed
in the installed MLX environment (`mlx-audio==0.4.5`). The configured
`generate_cloned_audition` and `render_plan_audio` paths both generated the synthetic sentence
“The garden gate stood open when I arrived.” using the pinned eight-bit model. Qwen3-ASR returned
those exact words for both outputs; the chapter was 2.48 seconds. The same checks passed against
the installed local catalog. This is a short integration smoke check, not a full-book quality claim.
Reproduce the unit checks with
`pytest -q tests/backend/test_model_config.py tests/backend/test_audio.py tests/backend/test_languages.py tests/backend/test_render_plan.py`
in the MLX runtime environment. Keep model and audio assets outside version control.

### 2. Judge settings on suitable audition text

Qwen conditions prosody on both instruction and text semantics. A single neutral line is comparable
across candidates but weak evidence for settings such as animated energy or restrained delivery. A
useful next experiment is a two-part fixed audition: a neutral identity sentence plus a punctuation-rich
delivery sentence. Keep the exact transcript beside the WAV.

### 3. Prefer candidate comparison over hidden retry tuning

Sampling is stochastic. Empty-audio retries protect reliability but do not select the most faithful
voice. If users still struggle after the prompt and sampling correction, offer two or three visible
candidates for one settings submission rather than silently retrying until one merely produces samples.
This costs proportionally more generation time but fits the existing candidate-review model.

### 4. Set honest expectations in the interface

Presentation, age, timbre and pitch primarily design the reference identity. Pace, energy, accent and
performance notes are generative guidance, not DSP controls. The accepted chapter voice may adapt them
to sentence meaning. The interface should not imply exact numeric enforcement.

## Sample-cloned auditions: implemented v2

Tune and generate offers voice design and sample cloning as alternative inputs. The sample path accepts
WAV, MP3 and FLAC clips between 3 and 30 seconds. Qwen3-ASR 0.6B drafts the words without a forced
language; the user can replay the compact local preview and must correct the editable draft before
submission. Draft failure falls back to manual typing. The backend decodes the file, rejects silence
and invalid duration, and normalizes it to mono 24 kHz WAV.

Qwen Base uses that normalized clip and matching transcript in its higher-fidelity ICL path to generate
the same displayed audition line used for designed voices. The generated line is the playable candidate;
the normalized upload and its transcript are retained separately as the production reference so
Generate does not recursively clone the audition. Both audio files are removed with the whole
working-book package.

An accepted cloned audition is marked `transcript-conditioned`, so later Qwen Base calls receive the
original `ref_audio` and the user-entered matching `ref_text`. The ASR result is only an editable draft:
no automatic transcript or alignment is accepted without the user's submitted correction, which
remains authoritative while enabling the model's stronger cloning path.

The earlier weak resemblance was consistent with the lower-fidelity speaker-embedding-only path. Qwen's
Base model contract explicitly warns that `x_vector_only_mode=True` does not need `ref_text` but may
reduce cloning quality. MLX-Audio's documented cloning example supplies both `ref_audio` and its matching
`ref_text`; its implementation enters the higher-fidelity ICL path only when both are present. The
application uses the correct Base renderer and now provides the required matching transcript rather than
passing unrelated audition text.

Explicit non-goals remain remote storage/sharing, a cross-book voice library, authoritative or stored
transcription, fine-tuning, and applying VoiceDesign controls to an uploaded sample.
