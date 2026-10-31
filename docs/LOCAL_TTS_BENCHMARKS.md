# Local speech-model benchmarks

Measured 2026-10-25 on Apple M5 Ultra, 96 GiB unified memory. This is a small English listening
screen, not a general TTS leaderboard. One listener rated samples with model names hidden.

## Selected default

Use **Qwen3-TTS Base 1.7B eight-bit** for uploaded-reference cloning and chapter rendering, paired
with **Qwen3-TTS VoiceDesign 1.7B BF16** for creating new reference voices. BF16 is 16-bit floating
point, not a larger architecture. The full-precision Base candidate and the full-precision
VoiceDesign model are different checkpoints with different jobs.

Eight-bit was the practical choice after the two-voice follow-up: better average reference fidelity
than four-bit, almost the same elapsed generation time for the same texts, and about 0.63 GiB more
peak MLX allocation. BF16 Base took roughly twice as long without winning overall. The first round
favored four-bit among the Qwen variants, so the evidence supports a default choice, not universal
eight-bit superiority. See [model setup](MODELS.md) for pins, downloads and upgrade behavior.

## First round: eight local variants

Three original English passages (Lighthouse, Ship and Keeper), with two seeded takes on Lighthouse:
four generated clips per variant, 32 total. Scores below are the three first takes, on a 1–5 scale.
No score is imputed for an unscored sample. The second takes contribute to performance measurements,
not these ratings. Separate delivery and fidelity questions were introduced only in the follow-up.

| Variant | Reference input | Lighthouse / Ship / Keeper | Four clips: generation seconds | Audio seconds | Peak MLX GiB |
| --- | --- | --- | ---: | ---: | ---: |
| Qwen Base 1.7B four-bit | Audio + transcript | 3 / 3 / 4 | 44.4 | 58.9 | 7.95 |
| Qwen Base 1.7B eight-bit | Audio + transcript | 2 / 3 / 3 | 46.1 | 56.9 | 8.58 |
| Qwen Base 1.7B BF16 | Audio + transcript | 3 / unscored / unscored | 81.8 | 57.2 | 9.88 |
| CosyVoice3 0.5B eight-bit | Audio + transcript | 4 / 4 / 2 | 43.3 | 73.8 | 4.25 |
| Maya1 3B BF16 | Written voice description | 5 / 4 / 3 | 49.7 | 70.4 | 6.41 |
| Step-Audio-EditX 3B eight-bit | Audio + transcript | 5 / 4 / 3 | 38.2 | 60.7 | 6.15 |
| Ming 3.0 dense 0.5B BF16 | Audio + transcript | broken, unscored / 3 / 2 | 45.1 | 59.5 | 4.20 |
| Ming 3.0 TTS Tiny eight-bit | Audio + transcript + speaker embedding | 2 / 2 / 2 | 37.3 | 46.9 | 11.44 |

Ming Tiny has a 7.9B / 1.3B-active language backbone, often described as an approximately 9B full
checkpoint. Eight-bit applies to its language weights; acoustic modules and routers retain floating
point. The much larger Ming Audio Flash is a separate system and was **not inference-tested**.

The Maya route used description-conditioned speech, not reference-audio cloning. Its high delivery
scores therefore do not establish replacement quality for a reference-preserving audiobook pipeline.
Step and CosyVoice were promising on some passages but inconsistent across the screen. Step's upstream
weight licensing remained unresolved for commercial adoption at the study date. This record is not a
license clearance for any candidate.

Both dense-Ming Lighthouse takes contained unusable output and are included in the timing totals.
Local Qwen ASR screened all clips; an independent CPU Whisper-small check covered six flagged takes.
The dense-Ming failures were not intelligibly recovered by either recognizer. Some Step output changed
or ambiguously pronounced words. ASR checks assess word recovery, not acting or speaker identity.

### Controls and implementation qualifications

- Qwen variants used identical reference WAVs, exact transcripts, text, per-take seeds 1031/1032,
  sentence splitting and primary sampling: temperature 0.9, top-k 50, top-p 1.0, repetition penalty 1.05.
  Runtime: MLX-Audio 0.4.5 / MLX 0.32.0. The native unquantized cache was retained.
- Candidate engines used their native synthesis paths. Equal numeric seeds across engines do not
  equate randomness. No line-level performance cues or quality-selected rerolls were applied.
- CosyVoice used mlx-audio-plus, 24 kHz reference audio and native defaults; its temperature parameter
  is ignored. First-call tokenizer setup is included in the measurements.
- Maya used its converter's framing, 200-character chunks, 300 ms gaps, temperature 0.4, top-p 0.9
  and repetition penalty 1.1. MLX-LM 0.32.2 / MLX 0.32.4; SNAC decoding ran on CPU. The wrapper needed
  compatibility adaptations for moved cache APIs before rendering.
- Step used mlx-speech 0.5.4, reference-conditioned synthesis without emotion edits.
- Dense Ming used MLX-Audio 0.6.1 and its corrected prompt contract. This port did not extract the
  CAM++ speaker embedding, so the observed result is not an isolated verdict on the upstream model.
- Ming Tiny used MLX-Audio commit `f976eab8b47a3cada5aeb3b52a78451ee06117bc` and native CAMPPlus.
  An experiment-only patch cast the audio-encoder attention mask to the query dtype; the decode limit
  was raised from 250 to 1000 to accommodate the longer passage. It is not a supported default.
- Playback used static gain toward −20 LUFS with peak protection. Some clips remained 1–3 dB below
  target. The listener noticed echo in the source reference; both issues motivated fresh references
  and a globally attainable loudness target in round two.

## Follow-up: two new voices, three Qwen precisions

Two synthetic VoiceDesign BF16 references, one brighter female American voice and one lower older
male English voice, each read two new passages. Every Base variant received the identical reference
and exact transcript for that voice. Twelve outputs, one take per combination, seed 1031; the same
Qwen sampling and unquantized cache as above. Reference prompts requested dry studio audio; no
independent listening claim of completely absent echo is made.

| Base precision | Delivery /5 | Reference fidelity /5 | Mean generation seconds per clip | Peak MLX GiB | Audio seconds / generation second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four-bit | 3.50 | 3.00 | 12.03 | 8.04 | 1.17 |
| **Eight-bit** | **3.75** | **3.75** | **12.12** | **8.67** | **1.07** |
| BF16 | 3.50 | 3.50 | 24.15 | 10.07 | 0.54 |

Eight-bit took 48.47 seconds versus four-bit's 48.11 seconds for all four texts: a 0.76% difference,
too small to establish a reliable speed penalty from this run. The audio-duration ratio differs
because the models spoke at different speeds. BF16 took 96.60 seconds. Model loading was measured
separately at about 1.91 / 1.93 / 2.50 seconds for four-bit / eight-bit / BF16.

Eight-bit received 4/5 on both dimensions for both female-voice passages. Results were mixed for the
male voice: four-bit's dialogue passage retained good delivery but scored 2/5 for identity, with a
voice change noted on the opening line. This is why fidelity is scored separately from pleasantness.

All twelve outputs matched the intended words in local ASR screening after punctuation normalization.
All fourteen playback files, including the references, reached −23.01 to −22.97 LUFS using static
gain alone, with final true peaks no higher than −2 dBTP. No compressor, limiter, denoiser or reverb
removal was used. Original audio remained available; the submitted ratings used matched playback.

## Provenance and reproduction

[Machine-readable measurements and model pins](benchmarks/local-tts-2026-10-25.json) record all
44 measured outputs, their hashes, timing and peak allocation, anonymized numeric ratings, exact
checkpoint revisions, and the follow-up voice prompts, reference transcript and passages. This file
contains no deployment settings, personal paths, credentials or operator infrastructure.

To repeat the comparison, download the exact checkpoint revisions into an isolated local experiment
environment; do not overwrite the application defaults. Generate each reference once with the pinned
VoiceDesign model and the recorded seed/prompt. Reuse that WAV and exact transcript for every Base
precision. Run models sequentially with the same sentence boundaries and sampler, retain failed
outputs, measure generation separately from loading, and apply one common attainable playback
loudness target before blind rating. Use independent delivery and fidelity questions.

The original audio and private operator harness are not redistributed by this record. Hashes identify
the measured files but do not provide access to them. Regenerated references can differ across runtime
or hardware versions, so this public package supports repeating the method and auditing the arithmetic,
not a claim of byte-for-byte reproduction of the original private listening session.

Peak MLX allocation is not total process RSS or whole-machine memory; CPU codec work is excluded.
Timing includes per-call preparation and audio writing, excludes model load, and was measured
sequentially. Four short clips per model cannot establish long-book throughput, concurrent-user
capacity, multilingual quality or statistical significance. No performance-annotation decision model
was benchmarked here; cue enrichment remains separate future work.
