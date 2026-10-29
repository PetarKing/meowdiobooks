# Native speech quality and recovery

Native chapter speech and auditions reject empty/nonfinite output, Qwen generation-limit
exhaustion, implausibly long output for its text, prolonged severe clipping and sustained
stationary broadband noise. A result's `token_count >= max_tokens` rejects it even when its
waveform is short. When token counts are unavailable, old WAV-only checkpoints use the exact
12.5 audio-token/second duration backstop, with half a sample of numerical tolerance. A known
below-limit token count takes precedence over that fallback.
One malformed output in a multi-result response rejects the whole response; dropping that
output could silently omit source words.

The inexpensive waveform pass uses 100 ms windows. Broadband rejection requires three seconds
of high spectral flatness, high zero-crossing rate and audible, nearly stationary energy
together. Single transients, brief fricatives and quiet speech are insufficient. The deliberately
loose text-duration ceiling is the larger of 30 seconds and 15 seconds plus the count of
alphanumeric Unicode characters, so unspaced scripts do not depend on English word counts.
The numeric policy and versioned receipt live in `backend/audio_quality.py`.

These checks reject catastrophic signals; they do not certify intelligibility, missing words,
pronunciation or speaker fidelity. Buzzing, repeated syllables and degraded speech can have
ordinary speech-like measurements and pass. There is no ASR inference or new runtime dependency.
A future ambiguous-speech detector needs independently evaluated evidence before adoption.

Chapter synthesis retains three recovery rounds. A rejected unit is retried with the existing
cooler sampling settings. After two quality rejections, the final round may split a long unit
at existing word/clause boundaries into at most eight parts, each attempted once with the third
settings. All source characters other than inter-request whitespace and the accepted voice
reference remain unchanged. Unsplittable inputs retain the ordinary third attempt. No child
retries or recursive splitting occur. The complete reconstructed unit must also pass waveform and text-duration validation. The token
limit applies to each inference call, not the sum of valid split calls. A private receipt records
sample boundaries, token counts and source hashes; cache reuse verifies the exact deterministic
source parts and revalidates every audio slice. Recovery labels or accepted flags alone cannot
bypass the single-call limit, and malformed boundary evidence forces regeneration.
The separate existing one-word, no-result speaker-embedding recovery is unchanged.

A rejected unit never enters a new checkpoint or playable chapter. Failure preserves existing
playable revisions and completed healthy checkpoints. Resumed checkpoint audio is checked against
its source unit before reuse, even when its WAV checksum is valid. Legacy healthy sections in a
compatible exact recipe get quality receipts without rerendering. The exact recipe still binds
source, voice, model, runtime and implementation; there is no automatic cross-release migration.

Private checkpoint sidecars retain `meowdiobooks.audio-quality.v1` scores and bounded requested
sampling settings/token metadata for successful and quality-rejected attempts. They do not add
source text. Rechecking cached audio preserves original attempt evidence. Chapter renderer receipts
name the quality contract. These receipts are diagnostic evidence, not accepted workflow state.

## Reproducible synthetic regression checks

Run `PYTHONPATH=src .venv/bin/python -m pytest tests/backend/test_audio_quality.py
 tests/backend/test_audio.py tests/backend/test_generation_checkpoint.py -q` (on one command line).

The fixtures contain generated modulated harmonic speech-like signals, brief fricatives, white
noise and clipping, with no customer recordings. Before the gate, a nonempty finite cap-length
waveform or five seconds of white noise passed; now both reject and enter bounded recovery.
The suite also checks valid speech at different amplitudes, conservative Chinese/uppercase/slow
text-duration allowances, corrupted-but-checksummed caches, partial model results, unchanged text
and voice through split recovery, retry exhaustion and checkpoint nonpublication. These synthetic
fixtures establish control flow and conservative signal behavior, not perceptual model quality.
