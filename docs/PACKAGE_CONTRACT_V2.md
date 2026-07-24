# Meowdiobooks package contract v2

Status: canonical alpha contract. Persisted alpha data has no migration guarantee.

This document defines the durable boundary between wizard phases. The detailed user workflow lives
in the [`wizard/`](wizard/README.md) specifications.

## Principles

1. Imported source bytes are immutable. Different bytes create a different book ID.
2. Every accepted phase consumes exact accepted upstream revisions.
3. Phase results are immutable JSON artifacts. Reruns append metadata revisions; they never overwrite
   history. Large voice binaries follow the current-Cast retention rule below.
4. One atomic stage-pointer map identifies the active artifact for each completed phase.
5. Source text and source ranges remain evidence. AI returns decisions keyed to supplied IDs, not
   rewritten source.
6. A failed or incomplete job publishes nothing. The last accepted artifacts remain active.
7. Rendering consumes a cached recording script compiled from accepted Dialogue, Review, Cast and
   optional Enrichment artifacts. It never reparses the PDF or reruns dialogue regexes.

## Package layout

```text
.meowdiobooks/
  books.json
  jobs.json
  packages/<book-id>/
    source/<original-filename>.pdf
    preview/
    artifacts/
      latest.json
      extraction/<revision>.json
      dialogue/<revision>.json
      review/<revision>.json
      cast/<revision>.json
      enrichment/<revision>.json
      script/<revision>.json
    voices/<character-id>/<voice-revision>.wav
    audio/<chapter-id>/
      latest.json
      <audio-revision>/
        chapter.wav
        metadata.json
        segments/*.wav
```

`artifacts/latest.json` is the single active stage-pointer map. Candidate, accepted and superseded
artifacts remain in their phase directories. Each chapter audio directory has a small atomic playback
pointer because chapters are generated and regenerated independently; it is not a second wizard-stage
pointer map.

`preview/` and failed-job temporary directories are disposable. Source, immutable artifact metadata,
the current Cast's voice references and published chapter revisions are durable. Superseded Cast
metadata remains inspectable, but its voice WAVs are not retained.

## Common artifact header

Every stage artifact contains:

```json
{
  "contract": "meowdiobooks.<kind>.v2",
  "kind": "<kind>",
  "revision": "opaque immutable revision ID"
}
```

Artifacts also record exact parent revision IDs. A candidate referencing a superseded parent cannot be
accepted. Revision IDs are opaque; ordering comes from recorded phase history, not lexical sorting.

## Source and book identity

The book ID and source hash derive from the exact PDF bytes. Import records the original filename,
media type, page count and PDF metadata used only for display. Encrypted PDFs and non-PDF product input
are rejected.

The stored source must hash to the accepted import hash before extraction. Reimporting identical bytes
reopens the existing book rather than creating a second semantic book.

## Extraction artifact

The Extraction revision is the only source text later phases may consume. It records:

- extractor method and version;
- pages in source order;
- stable paragraph/block IDs;
- exact page-relative block starts and verbatim block text;
- extractor warnings;
- available layout, reading-order and boundary evidence.

Concatenating blocks for a page must reproduce that accepted page text exactly. Changing Extraction
invalidates Dialogue, Review, Cast, Enrichment and the cached recording script. Existing audio remains preserved but becomes
stale relative to the new active chain.

## Dialogue artifact

Dialogue references one Extraction revision and partitions every accepted source block exactly once.
Each span records:

- stable span ID and source block ID;
- exact source and spoken ranges;
- verbatim source and speakable text;
- `renderRole`: `narration` or `dialogue`;
- literal or AI-resolved speaker label, speaker status and explicit fallback;
- regex, model or user provenance;
- chapter ID once chapter boundaries are accepted.

Configured open-speaker labels remain unresolved markers, not fake cast identities. The Dialogue
choice exposes configured open speakers and unlabelled candidates as independent AI target scopes;
unselected scopes use narrator fallback. Each AI call owns one detected unresolved/unlabelled target
and returns one speaker name, `?`, or `/`; no model-facing ID is needed. The application maps the
answer to its durable span or linked cross-boundary fragments.
Explicit deterministic labels and narration are not model targets. Bounded read-only context may cross
source block/page boundaries without changing ownership/ranges. If dialogue cannot be structurally
separated, the intact source region is narrator-only; there is no full-book attribution fallback.
Clean labelled square-bracket/curly-quote turns may be represented by linked fragments when their
closer occurs in a later block or page. A concrete new same-rule turn inside an outer claim becomes a
blocking structural issue with explicit `split`, `keep-together` and `narration` outcomes. Cross-rule
overlap decisions allow either profile or narration. These resolutions are persisted independently,
so changing an unrelated enabled rule does not discard them.
Dialogue acceptance includes its own result review; later Review does not silently change these spans.

## Review artifact

Review references one Extraction and one Dialogue revision. It preserves a snapshot of grouped warning
evidence and records one explicit decision per occurrence. Each occurrence includes exact source range,
adjacent context, severity, supported actions and provenance.

The accepted receipt contains:

- source-reconstruction status;
- decision and consequence summary;
- downstream invalidation preview;
- remaining blockers;
- a deterministic decision digest.

The user-facing warning vocabulary is limited to empty page, suspicious extraction, reading order,
repeated matter, page number, footnote and front/back matter. Lossless coverage failures cannot be
waived and are represented as a blocking recovery state rather than another content warning. The
accepted Extraction is not marked failed: the user rebuilds Dialogue first, or creates a new Extraction
only when the source itself is wrong. Review has no model-backed repair or character-guessing path and
never mutates accepted evidence invisibly.

## Cast artifact

Cast references accepted Dialogue and Review revisions. It contains:

- evidence dossiers for every gathered literal label;
- fuzzy and Qwen proposals plus explicit identity-review decisions;
- durable character/group IDs;
- complete literal-label-to-character-ID mapping and alias lineage;
- one narrator identity;
- immutable voice-candidate metadata for audit and current-Cast voice binaries for playback;
- editable voice settings and their exact compiled VoiceDesign direction per candidate;
- line counts used to order Cast/Voice review without changing identity authority;
- one accepted voice revision, reference WAV and exact matching transcript for every dedicated playable
  identity. A cloned candidate keeps its generated audition for review and its uploaded sample plus
  user-entered transcript as the production reference, all selected through one preserved candidate
  revision. Legacy transcript-free speaker-embedding artifacts remain readable;
- one whole-pack voice recipe version. Auditions are reusable only while it matches the currently
  registered version for the selected voice model. A changed or missing version preserves identities,
  mappings, settings, directions and routes but requires the complete audition pack to be regenerated;
- or, for a group only, a confirmed layered `voiceRoute` containing at least two existing character
  IDs whose own accepted voice revisions remain authoritative.

Fuzzy similarity and model proposals never perform a material merge automatically. Flagged identity
decisions block auditions. Missing or unaccepted narrator/character voices and incomplete group voice
routes block later phases. Layered routing never changes label, alias, or identity semantics. One Cast
revision never mixes auditions from different recipe versions.

The product has one usable Cast voice set per book. Regenerating one cast member replaces that
member's editable audition set instead of appending another reusable generation lineage. While a
complete replacement Cast remains a draft, the last accepted Cast stays usable. Accepting the
replacement atomically makes it the only Cast allowed to drive new generation and deletes voice WAVs
that are unreachable from it. Superseded Cast JSON remains inspectable, but its previews may be
unavailable and it cannot be reactivated for generation. Previously generated chapters and Library
exports are independent outputs and are never deleted by this replacement.

## Enrichment artifact

Enrichment is optional and references accepted Dialogue and Cast revisions. It is either an explicit
skip or a complete decorator result containing:

- one optional bounded `state` per supplied turn ID;
- optional ambience/effect descriptors over validated turn ranges;
- the bounded processing plan and workload estimate.

Enrichment cannot change source text, span boundaries, speakers, identities or voices. Current TTS does
not consume state, ambience or effects; they are presentation metadata and do not invalidate existing
synthesized speech.

## Recording script artifact

The recording script references exact Dialogue, Review, Cast and optional Enrichment revisions. It is
prepared automatically on first entry to Generate and reused while all four inputs match.

It faithfully owns every accepted source span exactly once. Review exclusions become explicit
`omission` entries; every other dialogue and narration span becomes a `source` entry in original order.
The script stores backend-owned whole-book and chapter metrics, including chapters with no playable
text. It has no model call and no separate user acceptance step. Publishing any upstream change removes
the active script pointer; immutable prior scripts remain available for audio-staleness comparison.

## Render plan and chapter audio

Generate compiles selected chapters from the active recording script and accepted Cast/optional
Enrichment artifacts. A render segment records:

- source span and recording-script entry IDs;
- final TTS text;
- effective character or narrator;
- explicit fallback reason, if any;
- accepted voice revision, reference WAV and transcript-conditioning or speaker-embedding mode;
- optional state metadata;
- joint/mix grouping metadata where supported.

Compilation validates exact source-span ownership and accepted voice readiness. Contiguous narration
may coalesce only when source order, effective voice, fallback and state are compatible.

Each completed chapter revision pins all input artifact revisions, language, renderer/model identity,
sample rate, segment metadata and omissions. Audio is written into a staging directory and becomes
current only after the complete chapter WAV and metadata validate. A failed regeneration leaves the
previous playable chapter revision untouched.

## Jobs and transactional publication

`jobs.json` records queued, running, canceled, succeeded and failed jobs with attempts, retry lineage,
progress, cancellation requests and errors. Heavy local model work is serialized. Queued jobs cancel
immediately. Running work stops cooperatively at its next progress or handler boundary, and a pending
cancellation wins over a concurrent successful return. Cancellation and failure do not publish partial
phase artifacts.

Dialogue output must contain exactly one valid result for every focused unresolved/unlabelled target
ID and no result for context-only IDs. Enrichment output must contain exactly one valid result for each
requested owner ID. Missing, duplicate, invented or malformed rows fail validation. TTS retries are
bounded; exhausted retries fail the chapter revision.

## Invalidation

Moving an active pointer removes active downstream pointers but never deletes immutable history.

| Accepted change | Invalidates active |
|---|---|
| Extraction | Dialogue, Review, Cast, Enrichment and recording script; generated audio becomes stale |
| Dialogue | Review, Cast, Enrichment and recording script; generated audio becomes stale |
| Review | Cast, Enrichment and recording script; generated audio becomes stale |
| Cast identity or voice | Enrichment and recording script; affected audio becomes stale |
| Enrichment | Recording script only; audio is unchanged while decorators have no audio consumer |
| Recording script | Generated audio becomes stale only when its effective entries change |

Stale audio remains playable and inspectable until a replacement chapter revision succeeds.

## Durable inspection

After completion, the book exposes active revisions and immutable history for every phase, including
source evidence, decisions, candidate-voice metadata, accepted aliases, recording scripts, render
metadata, fallbacks and previous chapter audio revisions. Only the current Cast's voice binaries are
retained or generation-eligible. Candidate and accepted status must be explicit; history must never
use an ambiguous “accepted-or-candidate” state.

## Compatibility

Only the v2 artifact graph above is supported. Legacy `analysis`, `structure`, renderer-reparse and
per-phase pointer contracts are not migration inputs. During alpha, incompatible persisted packages
must be rerun from PDF intake/Extract rather than maintained through permanent compatibility fallbacks.
