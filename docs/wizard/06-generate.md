# Phase 5 — Generate

## Purpose

Prepare or reuse one final recording script from the latest accepted artifacts, then compile selected
chapters and produce versioned playable audio.

## Phase contract

```text
Input:  selected chapter IDs + accepted Dialogue/Review/Cast revisions
Work:   prepare/reuse cached recording script → compile render plan → synthesize accepted render units
Output: versioned chapter WAV + segment metadata and pinned input revisions
Gate:   complete chapter and metadata validate before atomic publication
```

Example: a segment owned by `character:mara` resolves to Mara's accepted voice revision, then Qwen
Base receives only the accepted render text and that exact voice reference. It is not asked who speaks.

## AI use — REQUIRED TTS MODEL

Generate uses Qwen Base for speech synthesis. It uses no text LLM, prompt-based speaker analysis,
or identity inference. Recording-script and render-plan compilation are deterministic.

## User sees

- chapter selection and current/stale/generated status;
- cover-led chapter tiles with large chapter numbers;
- estimated audio length and local generation time per chapter and in total;
- inline WAV playback and opening the raw WAV in the Mac's default audio app;
- explicit generation and regeneration actions.

## TTS request and output contract

For each speakable render unit, Qwen Base receives the equivalent of:

```json
{
  "text": "We leave now.",
  "lang_code": "english",
  "split_pattern": "",
  "ref_audio": "voices/character:mara/<accepted-revision>.wav",
  "ref_text": "This is the voice of Mara. The bright morning carried a gentle breeze across the quiet village.",
  "temperature": 0.9,
  "top_k": 50,
  "top_p": 1.0,
  "repetition_penalty": 1.05
}
```

An ordinary render turn of up to 500 normalized characters is synthesized intact, including its
pauses and short phrases. This is an application context policy, not a provider input limit. Longer
text is split deterministically at sentence punctuation; fragments with fewer than eight Unicode
letters or digits remain with an adjacent sentence from that same render turn. An indivisible
sentence is never cut through a word to meet this soft threshold. These groups preserve the exact
normalized source text, accepted speaker and reference; they never cross a render-segment boundary.
A standalone one-word turn remains speakable input and is never replaced with silence or omitted.
Each unit tries the checkpoint-default `(temperature, top_k)` pair `(0.9, 50)`, then cooler recovery pairs `(0.75, 40)`
and `(0.65, 30)` until it gets non-empty, finite audio samples. Exhausted attempts distinguish no
returned results, empty sample arrays and non-finite arrays without including source text. If all attempts fail, the chapter
staging directory is discarded and the prior playable revision remains current. Adjacent joint-speaker
tracks are synthesized separately and mixed onto one timeline slot; ordinary units are concatenated
with 240 ms silence. A confirmed layered group route expands its group character ID to the route's
character IDs during deterministic render-plan compilation. Each member uses the accepted reference
revision already pinned by the same Cast artifact. Generate never reparses `&`, `/`, or “and” and never
guesses members.

If all three normal attempts produce no model results for a standalone, single-word
passage of at most 32 normalized characters, synthesis retries that exact text with
the same accepted reference WAV using speaker embedding, without transcript
prefill. This recovery has at most three attempts and is recorded per member and
unit in chapter metadata as `synthesisRecoveries`, including original/effective
reference modes and attempt counts. It does not change accepted Cast state or
conditioning for later passages. Exceptions, empty/nonfinite output, longer text,
and existing speaker-embedding requests do not trigger this recovery. Failure
still leaves the previous playable chapter intact; no silence or words are added.

The model output is audio samples only. The application writes per-segment WAVs, `chapter.wav`, and a
`meowdiobooks.chapter-audio.v2` metadata receipt containing source linkage, effective speaker, voice
revision, fallbacks, renderer model/language and pinned artifact revisions.

## Submit and processing

After submit, the application:

1. loads the accepted Dialogue, Review and Cast revisions;
2. reuses the cached recording script when its exact input revisions match, otherwise prepares and
   atomically publishes a new script before synthesis;
3. validates exact chapter coverage, every dedicated voice and every layered group's member routes;
4. compiles render segments directly from recording-script entries—never from regex reparsing;
5. slices spoken text from accepted source ranges and applies accepted render-text corrections;
6. calls Qwen Base with spoken text, language, the accepted reference WAV and its exact matching
   transcript; sample-cloned auditions keep the original uploaded reference and user-entered transcript;
7. records narrator/group fallbacks explicitly;
8. writes segment WAVs and metadata, assembles the chapter and atomically publishes success.

Review owns spelling repairs. Render compilation does not join line-break hyphens based on
other occurrences in the book. An uncertain decision or explicit Keep retains the accepted text;
an approved repair reaches TTS unchanged. For chapters retaining line-break hyphens, current/export
eligibility also compares the immutable audio receipt's segment text with the accepted render text.
An older recording with a different spelling (or missing receipt text) needs regeneration, even when
its input revision IDs match. Unaffected chapters retain normal recipe-based eligibility.

Current TTS receives no emotion/state instruction. Optional state/ambience decorators remain metadata
until an approved consumer exists.

## Result review

The user can play the complete chapter, open its raw WAV, see its actual audio length and regenerate it.
Failed chapters retain the prior playable revision. Successful chapters can be regenerated later from
newer accepted settings. Generate never bundles chapters or creates the portable audiobook file.

As soon as one current chapter is playable, the separate [Export phase](07-export.md) unlocks. Export
chooses and packages WAV revisions without changing them.

## Artifact and gate

Each chapter revision pins every input artifact, voice revision, renderer/model/runtime version and
synthesis parameter. No output becomes current until the complete chapter and metadata validate.

## Tests

- accepted transcript is the sole segment source;
- no call to legacy source regex/reparser;
- exact character-ID/voice mapping after alias and merge operations;
- narrator and joint/group fallback;
- Qwen Base request inputs and retries;
- segment/chapter atomic publication and previous-revision preservation;
- Public-domain fresh end-to-end chapter audio fixtures.
