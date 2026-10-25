# Local TTS sentence chunking

The reusable local chapter renderer groups complete sentences near a **120-character soft target**.
Ellipses (`...`, longer dot runs, and `…`) always end a generation request. Each ellipsis adds
**250 ms of silence** after its generated audio, including an ellipsis at the end of a segment.
This is an application recipe, not a Qwen context-window limit or a guarantee of pronunciation quality.

## Configuration

Set `MEOWDIOBOOKS_TTS_TARGET_CHARACTERS=120` in the renderer process environment. Raise or lower
that positive integer to tune the tradeoff between context and number of requests. Omission uses 120;
empty, nonnumeric, fractional and nonpositive values fail before model acquisition. Restart a resident
worker after changing its environment. Each chapter render captures one value for all its segments.
Changing this setting applies to newly generated audio; it does not rewrite existing recordings.

At each step the splitter chooses the complete-sentence boundary closest to the target; an exact tie
uses the shorter chunk. It never cuts a long sentence solely to meet the target. Very short fragments
borrow neighboring context within the same ellipsis block, using the existing eight-letter/digit
threshold. No words move across an ellipsis or accepted speaker segment. Common English titles and
initials retain their following text; fullwidth sentence terminators retain their closing quotes.
This is a punctuation heuristic, not a linguistic sentence parser for every language.

Text keeps its words and punctuation, with the existing NFC/whitespace normalization. Leading
ellipses in otherwise speakable text become silence without a punctuation-only model request.
Entirely non-speech accepted segments keep the existing skip policy. The existing 240 ms chapter
intersegment gap remains, so a terminal ellipsis before another segment adds 490 ms total silence,
in addition to any silence the model already generated. Ordinary sentence joins add no fixed gap.

Short single-word units isolated by an ellipsis can use the existing bounded speaker-embedding
fallback only after all three transcript-conditioned attempts return no results. Empty/nonfinite
samples and backend exceptions do not qualify. Accepted source and voice references remain unchanged.

Chapter metadata records `renderer.chunking` (policy, effective target, ellipsis pause) and each
segment's `synthesisUnits` with `text` and `pauseAfterSeconds`. These describe the requests and added
silence; the model can still supply additional natural pauses.

## Verification, 25 October 2026

The backend suite passed 984 tests with three optional/model tests deselected before the final
combined-CJK-punctuation regression was added. The final focused audio suite passed 84 tests with
two decoder tests deselected. Ruff passed. Tests cover nearest boundaries on either side, overlong
sentences, short tails, ellipses without whitespace, leading/terminal ellipses, exact sample counts,
quotes, configuration propagation and receipts, bounded recovery, cancellation and publication.

Two independent reviewers checked chunk preservation/target selection and audio/configuration
contracts. Their CJK closing-quote and combined-terminator findings were fixed and regression tested.

All three public-domain evaluation PDFs retained every NFC-normalized nonwhitespace character when
chunked. Brief initial excerpts from each were rendered through real `render_plan_audio`, using the
same Qwen3-TTS 12Hz 1.7B Base 8-bit model/reference and seed 1031 before and after the change:

| Source | Before: generation / audio seconds | Target: generation / audio seconds |
| --- | ---: | ---: |
| Alice | 2.62 / 11.44 | 2.79 / 12.16 |
| Pride and Prejudice | 2.81 / 12.24 | 3.06 / 13.20 |
| Ah Q, Chinese | 7.08 / 31.84 | 7.37 / 33.44 |

All six outputs were finite, nonempty, atomically published with metadata and latest pointers, and
left no staging directory. These short excerpts exercise generation/publication, not full-book
quality or attribution. Timing includes generation/publication, excludes initial model loading,
and is not a controlled general benchmark. The initial Alice render includes first-use preparation.

Reproduce deterministic boundary/assembly checks with:

```sh
uv run pytest -q tests/backend/test_audio.py -m 'not uses_audio_decoder and not runs_models'
uv run ruff check src/meowdiobooks/backend/tts_v2.py tests/backend/test_audio.py
```

For model verification, use the public-domain PDFs under `SampleBooks/public-domain-evaluation`,
the same accepted reference and seed for both versions, and save each render plan, resulting receipt,
WAV hash, timing and effective model revision. Listen separately; a successful render or ASR match
cannot certify pronunciation, pacing or acting. No automatic STT-based retry is introduced here.
