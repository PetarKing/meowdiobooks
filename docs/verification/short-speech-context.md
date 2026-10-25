# Short speech context and recorded recovery

## Scope and cause

This changes the reusable native synthesis contract: preserve normal accepted render turns, diagnose
missing model output, and record a bounded same-reference recovery for short standalone speech.
Operator probes, private sources, reference recordings, and generated private audio remain outside
this public repository.

The former splitter unconditionally split every turn at sentence punctuation, including a short
hesitation followed by the rest of the same speaker's sentence. With a transcript-conditioned Qwen
Base reference, the isolated hesitation could immediately sample EOS: three attempts yielded no
results, whereas the complete accepted turn produced finite speech in three of three probes.
The model architecture warning also appeared on successful requests and was not the cause.

Turns of at most 500 normalized characters now remain intact. This is a conservative application
chunking policy, not a claimed Qwen token/API limit. Longer input retains sentence boundaries while
keeping fragments with fewer than eight letters/digits beside neighboring text from that same turn.
The exact normalized characters, punctuation, order, speaker and accepted reference are preserved;
no cross-speaker joining, invented words, or silence substitution is used. Long indivisible sentences
are not cut through words to satisfy the soft threshold.

A standalone word can independently exhaust transcript-conditioned attempts. Only if all three
attempts yield **zero results**, a single unit containing one whitespace-delimited word and at most
32 normalized characters may retry with the same accepted WAV through the existing speaker-embedding
route. At most three additional attempts run. A yielded empty/nonfinite result or any initial backend
exception disqualifies recovery. Success records original/effective reference modes, reason, member
segment/character IDs, unit index, and initial/recovery attempt counts in `synthesisRecoveries`.
Neither accepted Cast data nor later units change mode. Failed recovery retains the previous
published chapter. The implementation does not patch model sampling or suppress EOS.

## Verification environment and commands

- Apple Silicon local runtime, Python 3.12, `mlx-audio==0.4.5`, local Qwen 1.7B Base 8-bit weights.
- Baseline shared release commit `7bdb0290bac575b849c99dd55dec78dc2d99ccb3`; candidate is this change.
- `PYTHONPATH=src python -m pytest -q tests/backend/test_audio.py tests/backend/test_render_plan.py tests/backend/test_generation_retry.py tests/backend/test_generation_status.py tests/backend/test_native_runtime.py -m 'not uses_audio_decoder'`: **97 passed**, 2 deselected.
- `PYTHONPATH=src python -m pytest -q tests/backend -m 'not uses_audio_decoder and not runs_models'`: **957 passed**, 3 deselected; one pre-existing Starlette/httpx deprecation warning.
- `ruff check src/meowdiobooks/backend/tts_v2.py tests/backend/test_audio.py`; `git diff --check`: pass.
- Independent review checked splitter source fidelity over 10,000 deterministic mixed Unicode,
  punctuation and whitespace inputs, and reviewed recovery gating, receipt member correlation,
  cancellation, later-reference reuse, and chapter atomicity.

Unit tests cover leading/middle/trailing/consecutive and quoted/CJK fragments, complete short turns,
long ordinary sentences, empty/nonfinite/no-result diagnostics, recovery eligibility and bounds,
same-text/same-WAV requests, next-passage conditioning, mixed-member receipts, interruption, and
previous chapter preservation.

## Actual local synthesis evidence

An authorized private accepted plan was rendered only into an isolated output directory, reading its
references without modifying accepted artifacts or live outputs. No private text or recordings are
included here. Before this change, the turn failed on its isolated opening fragment. Context
preservation fixed that turn but exposed a second genuine standalone-word failure later in the
chapter. With the bounded recovery, the complete plan succeeded: one chapter, **103.52 seconds** of
finite audio, **25.181 seconds** synthesis wall time, and exactly **one** recorded recovery. Every
normalized source character was preserved. The formerly fragmented turn remained one unit; local
ASR returned 10 words for 10 expected, with eight exact word matches. ASR is a supporting check,
not proof of perfect pronunciation.

Separate same-reference probes produced usable ordinary standalone “Yes”, “No”, and “Why” speech in
9/9 attempts, with matching local ASR. Two previously failing hesitation/interruption examples each
produced finite speaker-embedding recovery in 3/3 attempts; the user listened to both against the
accepted reference and accepted their sound. No reference identity was substituted. Forced minimum
codec-length and punctuation-only alternatives were explored but rejected for inconsistent speech.
A matched-seed precision comparison also returned zero results in all six attempts at both
8-bit and verified BF16 precision for the two isolated failing utterances; increasing precision did
not resolve this case. The recovery remains deliberately narrow; it is not a guarantee that every possible short utterance
will succeed.

## Public-domain source regression

The three bundled evaluation PDFs were extracted with `pypdf`, normalized using the unchanged
cleaner, and passed through both splitters. In each case, joining candidate units with a space
reproduced the exact normalized source. This synthesis-only check does not rerun unrelated LLM
extraction/attribution stages or change accepted decisions.

| Bundled source | Normalized characters | Prior / candidate units | Source SHA-256 |
|---|---:|---:|---|
| Alice | 4309 | 50 / 48 | `bdcefa11d58a0322e5eb4e47aa101e68cc69e48eb4b9553db0620257b2cdf19c` |
| Pride and Prejudice | 4751 | 62 / 58 | `ab7679c2fcd49880a6ddb3b7dc7a6d6b40682665d3cf5fcac6d939ead1a4ff31` |
| Ah Q, Traditional Chinese | 1315 | 14 / 14 | `1ca6a9e9d3d8d8cd88681cac7d955fda78e924911f9e4fddcd4ccb69e9820a97` |

A separate synthetic matrix used two distinct accepted reference recordings and English/CJK
short words. Both ordinary and speaker-embedding routes produced finite audio in 16/16 cases;
this matrix did not reproduce the zero-result recovery trigger. Exact local-ASR matches were
7/16 and 14/16 respectively. English ordinary yes/no/name cases matched for both references;
CJK ordinary conditioning with English references scored poorly (0/8 versus 7/8 for embedding).
Hesitation spellings and one short CJK utterance remained ASR-ambiguous. These observations do not
justify broad automatic mode switching: the implemented recovery only addresses exhausted
zero-result requests, not general pronunciation/ASR mismatches.

Bounded public-domain model comparisons used the same synthetic reference WAV/transcript,
source, language and model settings before/after. The reference transcript was “The quiet cat
stepped into the garden. A gentle breeze moved the leaves.” Its SHA-256 was
`0c0b30ee97653acd37df909080b1bf3b93943dd00e4cdc1f1c3199fd225d75c6`.
The probe capped output at 512 codec tokens/unit, used the first normal settings
`temperature=0.9, top_k=50, top_p=1.0, repetition_penalty=1.05`, and seeded each model call
with `51001 + sampleIndex*100 + unitIndex*3`. No recovery was needed.

| Sample | Prior / candidate units | Prior / candidate audio | Observed result |
|---|---:|---:|---|
| Alice: “What do you mean by that?” said the Caterpillar sternly. “Explain yourself!” | 3 / 1 | 4.00 / 4.48 s | Both finite; local ASR retained identical complete wording |
| Ah Q: first two body sentences, 92 normalized characters | 1 / 1 | 14.24 / 14.24 s | Finite, byte-identical WAV and identical ASR; unchanged control |

The Traditional Chinese control's ASR includes existing wrong words/homophones and simplified
script; unchanged output is a regression check, not proof of Chinese pronunciation accuracy.
The public model matrix and private full-plan pass cover the changed synthesis path; no hosted
provider calls or upstream LLM reruns were involved.
