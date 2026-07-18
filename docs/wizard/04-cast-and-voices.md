# Phase 4 — Cast & Voices

## Purpose

Turn all gathered literal speaker labels into reviewed durable identities, then generate and accept one
voice reference for every playable identity.

## Phase contract

```text
Input:  accepted Dialogue + Review revisions and all literal speaker labels
Work:   classify labels → human identity review → suggest voice settings → generate auditions
Output: durable label-to-character mapping + one accepted voice revision or confirmed layered route per playable identity
Gate:   every material identity decision and every required voice is explicitly accepted
```

When a new Review revision leaves the accepted Dialogue revision unchanged, the existing accepted
identities and exact audition revisions are reused as a fresh Cast candidate. The user re-accepts that
candidate against the new Review. **Review cast** opens the existing identity mapping for manual edits;
applying those edits keeps unaffected auditions and generates only voices invalidated by the structural
change. Display-name, source-label and primary-label changes keep the exact audition. A merge generates
one audition for the resulting identity; a split generates auditions for its resulting changed
identities. Category changes invalidate that identity, while audition-language or voice-model changes
invalidate the whole cast. **Reclassify from Dialogue** explicitly reruns label
classification from the accepted Dialogue and Review without overwriting the previously accepted Cast
revision. The new candidate must still be accepted. A Dialogue change also requires fresh classification.

Example: `Dr. Vey` and `the doctor` remain two source labels. If evidence supports one person and the
user confirms the merge, both map to one durable character ID. Generation follows that ID, not either
display string.

## AI use — REQUIRED, THREE DISTINCT CONTRACTS

This phase uses the local Qwen text model for label classification and initial voice suggestions, then
Qwen VoiceDesign for audio auditions. These are separate calls with separate authority.

## Identity evidence

The phase begins only after Dialogue and Review are accepted. It builds one dossier per literal label:

- occurrence count and first appearance;
- 2–4 representative dialogue/context windows;
- deterministic Unicode/case normalization;
- fuzzy candidate relationships;
- joint/group/unresolved-marker classification evidence;
- a bounded shortlist of labels with plausible spelling or token similarity.

Qwen receives one focused label at a time, its representative evidence, and at most eight loosely
similar candidate labels with their evidence. Unrelated labels are not valid relationship outputs.
Joint-delivery labels are not proposed as aliases for either individual member and are deterministically
kept as reviewable groups. When no candidates exist, relationships are deterministically empty
regardless of unused model text.
There is no model reconciliation pass. Only reciprocal same-identity claims are combined in code.
One-sided claims are downgraded to suggestions so a single bad model answer cannot transitively
absorb unrelated labels.

## AI contract A — literal-label classification

The system prompt defines four speaker types and forbids invented labels or unsupported facts. One
user prompt is sent per literal label:

```text
TARGET LABEL
the doctor

TARGET EVIDENCE
- “Stay still,” the doctor warned Mara.
- Dr. Vey closed the medical case.

RELATIONSHIP CANDIDATES
- Dr. Vey

CANDIDATE EVIDENCE

Dr. Vey:
- Dr. Vey closed the medical case.
```

The bounded candidate list is a closed reference set, not proof. Candidate evidence is included for
each deterministic fuzzy neighbor. The complete response must be one JSON object:

```json
{
  "speakerType": "one-person",
  "sameIdentityAs": ["Dr. Vey"],
  "possiblySameIdentityAs": []
}
```

Allowed `speakerType` values are `one-person`, `multiple-people`, `not-a-speaker` and
`identity-hidden`. Relationship entries must exactly copy candidate labels, may not include the target,
and cannot appear in both lists. The model does not invent or select a canonical name. Invalid objects
retry up to three logical attempts; failure aborts the Cast candidate.

Code owns the target label, combines only reciprocal certain relationships, derives review flags and
selects the most specific confirmed source label as the canonical primary label. A certain model
relationship groups labels as it does today; a possible relationship remains a review suggestion.
Audition lines and voice direction stay out of identity classification.

## User sees

- a compact Cast board with clear ready/review states and a pinned Narrator;
- an explicit source-label count and cast-member count so grouping never makes labels appear missing;
- amber tiles for reciprocal relationships that code applied and the user must review;
- violet tiles for uncertain relationships and material speaker-type classifications;
- a violet edge on an amber tile when an auto-grouped identity also carries a separate suggestion;
- one stable **Done** action in the cast-member inspector; structural edits keep review open until Done;
- an unconfirmed tile with more than three attached labels uses a red warning state;
- cast-member tiles merge by dragging the source tile onto the identity that should remain;
- dragging a cast member onto Narrator routes all of its literal labels to narrator delivery;
- Narrator has a permanent primary identity and cannot itself be dragged;
- narrator-routed labels remain reversible: pop a secondary label back into the cast, then move its restored tile normally;
- one focused cast-member inspector rather than a long list of open forms;
- source labels grouped under their current cast member with one explicit primary label;
- the primary label cannot be detached; secondary labels can be detached without changing the inspected member;
- one collapsed cumulative suggested-matches section per cast member instead of duplicated per-label suggestions;
- searchable label attachment results with one representative spoken line each and no unsolicited result wall;
- explicit rename, attach, detach and merge operations whose consequences are visible;
- model proposals kept as evidence while the reviewed alias mapping remains authoritative;
- book language configured once from the Cast toolbar rather than repeated inside Narrator;
- narrator voice tuning appears with the other auditions in Voice, not during Cast identity review;
- a separate Voice tile board with Narrator pinned first and the remaining cast ordered by descending
  line count;
- line counts on Cast settings and Voice tiles;
- Voice tiles open an inspector and never participate in identity drag-to-merge operations;
- the inspector puts audition text and generation settings first, followed by newest-first selectable
  candidate tiles with preview audio, compact settings and explicit applied/selected/available states;
- approving a tile applies that exact candidate revision, including an earlier audition, while final
  Cast acceptance remains a separate whole-cast action.
- a dedicated voice can select and replay a 3–30 second WAV, MP3 or FLAC sample; Qwen3-ASR drafts its
  transcript without forcing a language, the user corrects it to exactly what the speaker says, and
  Qwen Base creates another candidate. The normalized sample and matching transcript remain inside
  the working book.

## AI contract B — voice-profile suggestion

After identity review, Qwen receives one finalized cast member at a time. The default local policy
selects the first representative target line for each reviewed literal label, up to three labels. A
hosted provider may inject a larger bounded evidence policy without changing the identity or artifact
contract. Evidence is allocated round-robin across labels, with frequently occurring labels winning
ties when the total cap cannot represent every alias. Each selected line expands into its previous,
current and next structural source unit. This is structural context gathering, not a name, keyword,
pronoun or language-specific text search. The model sees surrounding
narration plus the target's own speech; other characters' dialogue is omitted so their vocal qualities
cannot leak into the suggestion. Narrator is one additional focused call using at most three narration
snippets.

The source units and target lines are assembled before the existing single Qwen call. The prompt is one
finalized identity:

```text
CAST MEMBER
Name: Mara
Role: character
Known source labels: Mara, the girl

REPRESENTATIVE TARGET SPEECH
- Mara: “We leave now.”

TARGET-SCOPED STORY CONTEXT
[SOURCE UNIT block:chapter-1-scene-3]
[SURROUNDING NARRATION] The young girl steadied her voice and faced the door.
[TARGET SPEECH: Mara] Mara: “We leave now.”
```

The structural-unit contract is format- and language-agnostic. It uses extraction provenance and source
ordering, preserves Unicode text, and falls back to page or individual-span units when a block identifier
is unavailable. Per-line, story-context and complete-prompt character ceilings truncate overlong source
in order instead of allowing a context-length error to block Cast. The prompt asks Qwen to interpret life
stage, gendered presentation and vocal-register
descriptions in the source language. Unambiguous physical/audible evidence is mandatory for the matching
presentation, age and pitch fields; representative target speech primarily controls tone, pace and
energy.

It returns eight editable starting points:

- presentation;
- age impression;
- tone/timbre;
- pitch;
- pace;
- energy;
- accent/dialect;
- one short additional-direction sentence.

Allowed fixed values are:

- `presentation`: `feminine`, `masculine`, `androgynous`, `unspecified`;
- `age`: `child`, `young-adult`, `adult`, `older-adult`, `unspecified`;
- `tone`: `warm`, `bright`, `dark`, `gentle`, `crisp`, `gravelly`, `neutral`;
- `pitch`: `low`, `medium`, `high`, `unspecified`;
- `pace`: `measured`, `natural`, `brisk`;
- `energy`: `restrained`, `balanced`, `animated`.

Example output:

```json
{
  "presentation": "feminine",
  "age": "young-adult",
  "tone": "warm",
  "pitch": "medium",
  "pace": "natural",
  "energy": "balanced",
  "accent": "unspecified",
  "description": "Clear and grounded, with quiet resolve."
}
```

This is a casting suggestion, not an identity claim. Fixed-choice fields accept only the values listed in
the system prompt; accent is at most 48 characters and description is 1–180 characters. Mental maturity
does not override a physical child voice. Generic words such as "young" do not alone establish the
`young-adult` bucket. Qwen must use `unspecified` when evidence is insufficient and must never infer an
accent from a name. Invalid output is retried once, then that cast member receives a conservative
deterministic fallback.

The application compiles the controls deterministically into direct VoiceDesign performance
instructions. Editing controls and regenerating does not call the text model again.

## AI contract C — VoiceDesign audition

The text model does not generate audition lines. Narrator and every cast member use the same
application-authored neutral template, localized to the selected voice language:

```text
This is the voice of <name>. The bright morning carried a gentle breeze across the quiet village.
```

This preserves a comparable synthetic introduction while providing enough sound and rhythm variation
to hear pitch, pace, timbre and accent. Each configured voice language has a fixed equivalent. The
interface language does not affect the audition; the selected voice language does.

The application compiles the accepted or edited handles into one `instruct` string. VoiceDesign
receives:

```json
{
  "text": "This is the voice of Mara. The bright morning carried a gentle breeze across the quiet village.",
  "instruct": "Use a warm, rounded vocal timbre. Speak at a natural conversational pace. …",
  "lang_code": "english",
  "split_pattern": "",
  "temperature": 0.9,
  "top_k": 50,
  "top_p": 1.0,
  "repetition_penalty": 1.05
}
```

The output is finite audio samples. The application rejects empty or non-finite samples and retries
with cooler `(temperature, top_k)` pairs `(0.75, 40)` and `(0.65, 30)`. The primary request matches
Qwen's checkpoint generation defaults. A successful call stores a new WAV candidate with its exact
text, direction, settings and parent revision. It never auto-accepts it.

An accent entry is compiled as an explicit pronunciation instruction while preserving the selected
text language. For example, `Japanese` with English selected tells VoiceDesign to keep every word in
English and make the Japanese accent audible through pronunciation and rhythm. Accent and the other
controls remain generative guidance, so listening and explicit candidate selection remain mandatory.

## Submit and processing

1. Build fuzzy candidates and classify each label with one focused Qwen call.
2. Require the user to resolve every flagged identity.
3. Use one focused Qwen call per finalized cast member plus Narrator to propose editable voice
   settings.
4. Compile those settings and generate auditions only after flagged identity decisions are resolved.
5. In Tune and generate, either use Qwen VoiceDesign with editable traits/direction or select a sample.
   Qwen3-ASR drafts its transcript with automatic language detection; the user replays the compact
   preview and corrects every word. Qwen Base then uses that exact matching transcript to perform the
   same displayed audition line, and that generated performance becomes the candidate users compare.
6. Preserve candidate history; regeneration selects the new candidate for comparison but never
   replaces the applied candidate automatically.

## Result review

The user can listen to and approve one exact available audition revision for every narrator or
character identity. A group can instead use a confirmed layered voice route containing at least two
existing character IDs. An unambiguous connector label such as `Subaru & Cecilus` defaults to its exact
layered suggestion, but remains visibly unconfirmed and blocks Cast acceptance until the user confirms
the members. Editing the member list invalidates that confirmation. Layered preview mixes the members'
currently applied audition revisions through the same peak-safe mixer used by Generate and reloads when
an applied member audition changes. Ordinary auditions can be removed from the current draft whenever
another candidate remains; the final candidate is protected. The route changes audio only: it does not create aliases, rewrite
Dialogue, or claim general group membership. A dedicated group audition remains available when the
members are unknown or a layered result is artistically poor.

Earlier audition revisions remain selectable rather than becoming display-only history. At final Cast
acceptance, any still-unapproved dedicated voices require an explicit confirmation to use their latest
audition; explicit approvals always win. Layered routes pin member character IDs, and Generate resolves
their exact accepted revisions from the same immutable Cast artifact.

## Artifact and gate

The accepted Cast revision contains durable character IDs, literal-label mappings, alias lineage,
review decisions, accepted voice WAV/transcript revisions, and any confirmed group `voiceRoute`.
Dialogue spans resolve through character IDs, never display names. A reviewed `narrator` assignment
deliberately maps that literal label to the narrator fallback rather than creating a playable
character. Identity corrections update the mapping consumed by rendering.

## Tests

- Unicode normalization and conservative fuzzy candidates;
- contextual one-label prompts, exact relationship validation and deterministic conflicts;
- aliases, merge/split/rename lineage and collision prevention;
- editorial/unresolved-marker/group classification;
- conservative exact-name group-route defaults, explicit confirmation, manual member selection and
  mixed-preview refresh after an applied audition changes;
- flagged identities block auditions and progression;
- exact current or historical voice-revision acceptance and unavailable-reference failures;
- accepted layered routes expand to the members' accepted voices in Generate;
- direct performance-instruction compilation for every editable handle;
- accent preserves the selected text language and requests audible pronunciation/rhythm changes;
- one deterministic neutral audition template for Narrator and every cast member;
- identity changes affect the correct render segments.

See the [Qwen runtime contract](../QWEN_RUNTIME_CONTRACT.md) for exact inputs, outputs, call counts,
retry/fallback behavior and the Base TTS handoff.
