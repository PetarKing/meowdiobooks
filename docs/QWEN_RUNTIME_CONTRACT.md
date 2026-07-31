# Qwen runtime contract

This document is the end-to-end source of truth for every Qwen-family inference in the current
wizard: when it runs, what it sees, what it may return, how its output is validated and what remains
deterministic.

## Model roles

| Runtime | Role | May change source or identity? |
|---|---|---|
| Qwen3.5 9B Q4_K_M through pinned `llama.cpp`, or the explicitly selected OpenAI-compatible remote Dialogue profile | Small, focused text decisions and suggestions | No |
| Qwen3-TTS VoiceDesign 1.7B | Creates audition/reference WAVs from text plus voice direction | No |
| Qwen3-TTS Base 1.7B 4-bit | Renders accepted book text using a reference WAV and its exact matching transcript | No |

The default text and voice models run locally, and heavy local models run sequentially. Dialogue may
instead use an explicitly selected OpenAI-compatible remote profile, which receives only the selected
bounded source passages. Local text inference uses temperature `0`, JSON mode where applicable and
thinking disabled. Voice models are sampled, so the same request can produce a different performance
on a later revision.

## Whole-wizard call map

| Wizard work | Normal call count | What Qwen sees | What Qwen returns |
|---|---:|---|---|
| PDF intake (before Step 1) | 0 | Nothing | Nothing |
| Extract | 0 | Nothing | Nothing |
| Dialogue focused attribution | Local: one base call per target and one verifier when required. Remote: two differently framed checks per target. | One bounded passage for one target; no model-facing source ID | A name only when both required checks agree with literal support; `/` only under the applicable consensus rule; otherwise `?` |
| Review | 0 | Nothing | Nothing |
| Cast label classification | One text call per literal speaker label | Target label; 2–4 evidence examples; up to eight loosely similar candidate labels with evidence | Speaker type plus certain and possible exact-candidate relationships |
| Initial voice-profile suggestions | One text call per finalized cast member, plus Narrator | Reviewed name/category/labels; provider-bounded target lines allocated across aliases (the local default is at most three); adjacent structural source units containing narration and target speech | Eight editable settings: presentation, age, tone, pitch, pace, energy, accent and short description |
| Initial voice auditions | One VoiceDesign call per finalized cast member, plus Narrator | Deterministic neutral audition text; compiled performance direction; selected language | One candidate reference WAV |
| Regenerate one audition | One VoiceDesign call | Edited settings compiled in code; same neutral text contract; selected language | One new candidate reference WAV |
| Draft a voice-sample transcript | One Qwen3-ASR call | Normalized 3–30 second sample; no forced language | Editable transcript draft plus detected language |
| Clone one audition from a voice sample | One Base TTS call | Normalized WAV, the user-entered exact sample transcript, the same deterministic audition line and selected language | One playable audition WAV plus its retained speaker-reference WAV and transcript |
| Delete one audition | 0 | Nothing | A new Cast draft without that candidate; at least one audition is always retained |
| Accept Cast | 0 | Nothing | Nothing |
| Enrichment, when enabled | One text call per bounded transcript window | Accepted turn IDs, text, identities, context and enabled options | Turn states and optional ambience/effect ranges keyed to supplied IDs |
| Recording-script preparation | 0 | Nothing | Faithful, source-linked entries cached by exact accepted input revisions |
| Generate | One or more Base TTS calls per render unit | Accepted spoken text; language; reference WAV; its exact matching transcript | Audio samples |

“One call” above means one logical request when the model follows the contract. Bounded retries may
cause additional inference attempts.

## Text-model transport

For local text work, the application starts one pinned `llama.cpp` server for the operation, waits for
`/health` and sends OpenAI-compatible chat-completion requests to it. A request contains:

- one operation-specific system prompt;
- one focused user payload;
- model `qwen3.5-9b`;
- temperature `0`;
- an operation-specific output-token ceiling;
- `enable_thinking: false`;
- JSON response mode for JSON contracts.

When the user explicitly selects a remote Dialogue profile, the application runs **Dual pass with
tools**: bounded eight-page scenes go to independent low- and medium-reasoning passes, and meaningful
disagreements receive selective high-reasoning adjudication. Evidence tools can inspect a target,
read immediately before or after its scene, retrieve wider target context, and search the rest of the
book. Tool outputs are bounded source excerpts. Consequently, a complete run may transmit text from
any part of the book even though no single request contains the whole book. The configured credential
remains server-side and is not written to artifacts or sent to the browser. Cast, voice design,
generation and every non-Dialogue phase remain on their configured local runtimes.

Malformed transport or response syntax is retried at most three times. A temporary `503` is retried
within the readiness deadline. A persistent transport failure aborts the candidate job; it does not
change the last accepted artifact.

Operation-level semantic validation is separate:

- Dialogue retries an invalid answer at most three logical attempts.
- Cast identity classification retries an invalid three-field object at most three logical attempts.
- Voice-profile suggestion retries an invalid eight-field object once, then uses a conservative
  deterministic profile for that cast member.
- Enrichment receives generic syntax retries, then its complete output is validated transactionally.
  A semantic contract failure aborts that candidate rather than partially publishing it.

## Dialogue attribution

Qwen is not asked to rediscover dialogue or echo explicit speakers. Deterministic scanning first
identifies dialogue whose speaker is still unresolved, and the user chooses which unresolved classes
to send.

For local attribution, each target's base check sees `BEFORE`, `SPEECH` and `AFTER` and returns exactly
one name, `?` or `/`. A base `?` or configured unknown marker is final without another call. When the
base proposes a name or `/`, the same local model receives the byte-identical user prompt under an
independent conversation/identity verifier instruction.

Remote attribution instead runs two differently framed checks over the same ordered bounded passage.
Local and remote results publish the same check record and use the same consensus, literal-evidence and
review-suggestion rules. A character is retained only when the required checks agree after
whitespace/case normalization and have literal support in the supplied context; otherwise the result
uses narrator fallback and any supported disagreement remains only a review suggestion.

Base and verifier syntax retries are independent. Exhausting either required mechanical retry aborts
the complete candidate rather than publishing a partial result. The application applies the final
answer to the call-owned source span(s) and checks that the complete selected target set was resolved.
IDs, source text and span boundaries are never model-authored.

## Cast identity classification

The application gathers every literal label before calling Qwen. Each label is deliberately a small,
independent task. Qwen may relate it only to exact strings in a bounded shortlist of loosely similar
labels, with evidence supplied for every candidate.

Classification runs for the first Cast candidate, after a Dialogue change, or when the user explicitly
chooses **Reclassify from Dialogue**. Review-only changes reuse the accepted identities and auditions by
default; manual Cast edits update that mapping and regenerate auditions without silently rerunning this
classifier.

Code—not Qwen—owns the target label, validates relationship strings, combines reciprocal certain
relationships and derives review flags. Fuzzy spelling similarity is candidate discovery, not an
automatic merge. Material ambiguity remains for the human to resolve.

## Voice-profile suggestions

The application selects the first representative target line for each reviewed literal label, up to
three labels, without adding filler scenes after those labels are represented. Before the identity's
single Qwen call, each selected line expands to the previous, current and next structural source unit.
Only narration and the target identity's own speech are included; other dialogue is omitted. This uses
source ordering and extraction provenance rather than name, keyword, pronoun or language-specific
searches. Unicode text is preserved, and missing block IDs fall back to page or individual-span units.
Individual source lines are capped at 1,200 characters, story context at 4,000 characters and the complete
user prompt at 6,000 characters. Overlong source is truncated in order with an explicit marker; it never
turns a valid Cast candidate into a context-length failure.

Qwen must honor unambiguous physical and audible descriptions in the source language for presentation,
age and pitch. The selected target speech mainly informs tone, pace and energy. It still returns only
the existing eight editable settings in one logical call; there is no evidence-discovery or
reconciliation model pass. These are editable casting suggestions, not identity facts. The prompt
forbids inferring an accent from a name and requires `unspecified` when evidence is insufficient.
Invalid objects receive the existing bounded retry and conservative fallback.

Narrator profiling is deliberately separate from character profiling. Up to eight narration snippets
are sampled at evenly spaced positions across the accepted book, then one concise instruction asks for
a confident interpretation of the whole work. Book-motivated accents, dialects and distinctive
performance choices are allowed; the model should not choose neutrality merely because several valid
interpretations exist. Close or first-person point of view can inform attitude, but must remain
long-form storytelling rather than automatically becoming an acted protagonist voice. The result uses
the same editable eight-field voice contract and audition gate.

When a hosted OpenAI Responses adapter is selected, the provider also receives a strict JSON Schema for
Dialogue attribution, Cast discovery and adjudication, voice profiles, and Enrichment. The schema owns
shape, required fields and fixed enums. Existing application validators continue to own semantic rules
such as exact target coverage, ordering, uniqueness, evidence support and text-length budgets. Local
Qwen keeps its JSON response mode and the same validators.

The default local Qwen workflow does **not** write audition dialogue. Audition text is a deterministic
application template shared by Narrator and every cast member, localized to the selected voice
language:

```text
This is the voice of <name>. The bright morning carried a gentle breeze across the quiet village.
```

The second sentence supplies enough pronunciation, pitch, pace and timbre variation to compare
candidates without feeding the model a potentially unrepresentative real line. Every configured
voice language has its own fixed equivalent; the interface language never changes the spoken text.

Hosted compositions may opt into a separate line-only text-model task after the existing eight-field
voice profile has been validated and frozen. This does not extend or retry the profile schema: the
second call receives the frozen profile, the same bounded character evidence, and the selected
synthesis language, and may return only `auditionLine`. The application validates and stores that
150–300-character field outside `voiceSettings`; invalid or missing output uses the same deterministic localized
template after one bounded validation retry. Shared voice groups always use the deterministic shared
line.

## VoiceDesign audition request

Every editable handle is compiled in code into direct performance language. For example, an English
audition with a Japanese accent contains:

```text
Speak the English text with a clearly audible Japanese accent or dialect.
Keep every word in English; change the pronunciation and rhythm, not the language.
```

Presentation, age, timbre and pitch are compiled into one natural voice-identity sentence. Pace and
energy form a separate delivery sentence, followed by any accent instruction and the user’s additional
direction. A final precedence sentence keeps edited fixed traits from being silently overridden by stale
or contradictory additional notes.

VoiceDesign receives only:

- `text`: the deterministic audition template in the selected voice language;
- `instruct`: the compiled performance direction;
- `lang_code`: the selected book language;
- the checkpoint-default sampling settings (`temperature=0.9`, `top_k=50`, `top_p=1.0`,
  `repetition_penalty=1.05`) on the primary attempt.

It gets up to three sampling attempts when generation errors or yields no usable samples. The two
recovery attempts use cooler sampling, not a different voice contract. A successful candidate stores
its exact WAV revision, reference text, compiled direction, editable settings and parent candidate
revision. Regeneration appends and selects a candidate for comparison; it never silently replaces the
applied revision.

Accent, tone and other handles are generative guidance, not hard DSP constraints. The direct compiler
and longer sample make their effect materially easier to hear, but the user must still audition the
result and regenerate or revise the direction when the model under-expresses it.

## Acceptance and chapter rendering

Approving a voice selects any exact available candidate revision, including an earlier audition.
Whole-Cast acceptance calls no model and pins those per-character approvals. Any identity without an
explicit approval requires a visible confirmation before its latest audition is pinned as the default.

An uploaded WAV, MP3 or FLAC sample is decoded locally, bounded to 3–30 seconds and normalized to mono
24 kHz WAV. Qwen3-ASR makes one unforced-language transcript draft, which is neither stored nor trusted;
the user may replay the selected local file and must edit the draft to exactly what the speaker says.
Failure leaves ordinary manual entry available. Qwen Base then conditions on the matching audio/text prompt to perform the same
deterministic audition line shown in Cast review. The playable candidate is that generated audition,
not the uploaded clip. The original upload is discarded; the normalized speaker reference, matching
transcript and audition WAV live under the working-book package and are removed with that book.

During Generate, deterministic code resolves each accepted dialogue span to a durable character ID
and accepted voice reference. Generated auditions use Qwen Base's transcript-conditioned cloning with
the exact audition transcript. Sample-cloned auditions retain the uploaded reference and user-entered
matching transcript. Base does not receive the Cast controls or VoiceDesign instruction: their audible
result is embodied in a generated reference, while an upload supplies its speaker identity directly.

Current Enrichment state, ambience and effect metadata are not consumed by Base TTS. The UI and
artifacts must not claim otherwise.

## Revision and failure rules

- Model output is always a candidate until explicitly accepted where review is required.
- A failed or interrupted job publishes nothing and leaves accepted work unchanged.
- User identity decisions and exact accepted voice revisions outrank later model suggestions.
- Earlier voice candidates remain inspectable after regeneration.
- Deleting an audition removes it from the current editable draft only. Immutable artifact history and
  its underlying audio remain until the working book is deleted, so draft cleanup cannot break an
  already accepted Cast.
- No Qwen pass may invent source IDs, change accepted source text or mutate durable character IDs.

## Code pointers

- Text-model server and shared retry behavior: `src/meowdiobooks/backend/local_llm.py`
- Dialogue prompts and validation: `src/meowdiobooks/backend/dialogue_ai.py`
- Cast identity and voice-profile prompts: `src/meowdiobooks/backend/cast_service.py`
- VoiceDesign generation: `src/meowdiobooks/backend/audio.py`
- Enrichment calls: `src/meowdiobooks/backend/app_v2.py`
- Base TTS rendering: `src/meowdiobooks/backend/tts_v2.py`
