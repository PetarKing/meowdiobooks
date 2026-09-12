# Phase 2 — Dialogue

## Purpose

Produce the authoritative, source-anchored narration/dialogue transcript. Deterministic formats own
structural separation; Qwen only attributes detected dialogue whose speaker remains unresolved. This
phase does not finalize character identity, generate voices.

## Phase contract

```text
Input:  accepted Extraction revision + regex/open-marker/AI-scope settings
Work:   deterministic scan → resolve structural issues/overlaps → optional focused attribution
Output: complete source partition: every source character is narration or dialogue exactly once
Gate:   structural issues and overlaps must be resolved; the complete candidate must be accepted
```

Example: `Mara: [Run.]` becomes an explicit dialogue span labelled `Mara` without AI. A detected
unlabelled `“Behind you!”` may be sent to Qwen with nearby context, or left to narrator fallback.

## Deterministic scan

All enabled built-in and user regexes run over bounded accepted extraction blocks. Built-ins include:

- `Name: [dialogue]`;
- `Name: “dialogue”` and straight-quote equivalents;
- `Name — dialogue`;
- conservative uppercase `NAME: dialogue` within one extracted paragraph;
- opt-in screenplay speaker line followed by dialogue block;
- unlabeled curly, straight, guillemet and CJK quotation candidates.

Each regex declares a stable ID, priority and named captures. `text` is required; `speaker` is optional
for candidate-only patterns. User regexes are raw regular expressions. The application shows every
regex with at least one match, representative matches and the delta from enabling/disabling it.

Conflicting/overlapping matches are never silently selected. Priority resolves only non-conflicting
ordered application; actual source-ownership conflicts remain visible. The user may choose either
interpretation, leave the overlapping source as narration, or change the enabled rules.

The uppercase colon rule deliberately excludes bracketed and quoted text immediately after the colon,
because those formats belong to the more specific labelled rules above. Wrapped visual lines remain in
the same turn when extraction geometry proves they belong to one paragraph. Equivalent built-in/custom
claims over the same speaker and spoken range coalesce into one turn; genuinely different overlapping
claims continue through the explicit conflict-review contract.

### Structural preflight

The scanner makes only two structural interventions before AI:

- A labelled square-bracket or curly-quote turn that cleanly closes in a later block or page is linked
  as one logical turn. The delimiters are asymmetric, no competing labelled start appears first, and
  the scan is capped at eight blocks/6,000 characters. Source ownership remains split into exact
  per-block fragments; nothing is concatenated into a new source range.
- When a new same-format labelled turn starts before an outer turn closes, the outer claim is withheld
  and the user chooses `split`, `keep together`, or `leave as narration`. A complete custom-regex match
  nested inside another complete match from the same custom regex uses this same review. Arbitrary
  regex-language intersection is not guessed.

Straight quotes are not carried across block/page boundaries because the same character opens and
closes them. A dangling `"` therefore cannot silently consume later blocks. It may still expose a
concrete interrupted labelled turn, which follows the explicit-choice path above.

## Configurable open-speaker markers

The user can configure literal labels or label regexes that mean the source intentionally withholds
identity, such as `???`, `UNKNOWN` or `Unidentified Voice`. These are stored as unresolved status, not
created as cast characters. Descriptive labels such as `Guard`, `Boy` or `Everyone` remain literal
provisional labels until Cast reconciliation.

## User sees before processing

- total explicit-format turns;
- turns with non-open literal labels;
- turns using configured open-speaker markers;
- unlabeled quotation/dialogue candidates;
- screenplay and other format matches;
- interrupted same-rule turns and cross-rule overlaps;
- each successful regex, its count, examples and enabled state;
- representative source/result examples.

The UI reports detected counts, never an unprovable percentage of all dialogue in the book.

## Raw regex editing

The user can add, edit, order, toggle and remove multiple regexes. Custom rules accept the explicit
`m` (multiline) and `s` (dot-all) flags. Each change reruns the deterministic
preview and shows added, removed and changed matches. Regexes operate locally on bounded blocks. The
application validates compilation, required captures, zero-width matches and source ownership. Any two
custom or built-in rules that claim overlapping source use the same overlap review. A custom regex is
reported as recursive only when that compiled regex produces a concrete complete inner match; general
static regex-overlap proofs are intentionally out of scope.

## Processing contract

Deterministic structure comes first. After optional regex refinement there are only two valid paths.
AI attribution is one top-level choice with two independently selectable target classes: configured
open-speaker markers and unlabelled dialogue candidates. Any unselected class uses narrator fallback.

### Structurally separated dialogue

Explicit captured speakers remain locked. Qwen processes only detected dialogue spans whose speaker is
a configured open marker or was not captured. It does not classify narration, re-evaluate explicit
labels or search the complete book for undiscovered dialogue.

Each request contains exactly one detected target and a bounded `BEFORE`/`AFTER` window. Open-speaker
turns receive broader conversational context. Unlabelled quotations keep their quote marks and receive
tight containing-sentence context to avoid unrelated names. A proposed character name receives a
second local check using the exact same user prompt; configured unknown markers, `?` and `/` skip that
verifier. Durable source IDs remain application-internal and source ownership/ranges never change.

### No safe structural separation

If no enabled deterministic format can separate dialogue from its surrounding prose, there is no safe
speaker-attribution target. The user may refine/add regexes or accept narrator-only rendering for the
inseparable source region. Narrator-only preserves the complete paragraph/block; it is not a hidden
full-book model pass and does not claim that dialogue recall succeeded.

The user may also choose narrator fallback for detected unresolved dialogue. The complete containing
paragraph remains narrator-read while explicit speaker-labelled turns elsewhere stay dynamic. An
honestly unresolved focused-Qwen result uses the same fallback.

## AI use — OPTIONAL, FOCUSED TEXT MODEL

AI runs only when the user chooses `fill-gaps` and selects at least one detected target class:
`open-speakers` and/or `unlabelled-candidates`. Explicit labels, narration and undiscovered text are
never sent for classification. Choosing narrator fallback makes zero model calls for those targets.

### Prompt contract

The system prompt asks one question: **who speaks `SPEECH`?** It defines attribution precedence,
distinguishes a quoted term inside narration, and permits only a name, `?`, or `/`. The user prompt is
always this shape and contains no durable ID:

Input contains one target and no ID:

```text
BEFORE
Subaru: Where is she?

SPEECH
Right behind you.

AFTER
Louis stepped from the doorway.
```

### Input limits

The model sees only the rendered window above: bounded text before the target, the target speech, and
bounded text after it. Default limits are 700 context characters per side, up to six context units,
1,200 target characters and 6,000 prompt characters. Unlabelled quotation candidates use one nearby
context unit per side.

### Output contract

The complete model response is one non-empty line:

```text
Louis
```

The only valid values are:

- one name literally supported by the supplied context, for example `Louis`;
- `?` for dialogue whose speaker cannot be established;
- `/` for a quoted term that belongs inside narrator prose.

Extra lines or malformed answers are invalid. The base check and any required verifier independently
retry malformed responses up to three times; an exhausted mechanical retry fails the complete job and
publishes nothing. A character is retained only when both names have literal context support and are
either the same normalized name or a conservative name variant: whole-token containment with at least
one five-character token, one edit across names of at least five characters, or a strict fuzzy match
across longer names. Containment selects the longer answer; other equivalent variants retain the first
answer. Other disagreement or unsupported evidence becomes `?`; supported names from a disagreement
may be shown as human-review suggestions but are never assigned automatically. A valid `?` is not a
mechanical failure and publishes narrator fallback for that turn. The application maps the
answer to its internally owned target; the model cannot author IDs, ranges, source text or explicit
speaker labels.

Local and remote attribution publish the same check record and use the same consensus, literal-evidence
and review-suggestion rules. Their prompts and context sizes may differ, but their review behavior does
not.

Thought is not skipped. If classified as dialogue it uses the resulting speaker; otherwise the intact
paragraph remains narration. Dialogue processing never makes source material permanently non-spoken.

## Dialogue result review

This phase has its own review before acceptance. The user sees:

- deterministic explicit results and representative successes;
- AI-assigned turns and their local context;
- still-unresolved results and effective fallback;
- joint/group labels;
- regex overlaps and user-resolved interrupted turns;
- source on the left and authoritative transcript result on the right.

The user can accept the complete candidate or return to regexes, open-marker configuration and AI
target scope and rerun. AI-checked lines can be filtered as Character, Suggested, Unsure or Narrator.
Suggested means the independent checks disagreed but supplied one or more context-supported speaker
options: Narrator still reads the line unless the user chooses one. Unsure means the checks withheld a
character assignment without a supported suggestion. A single line can be corrected in place to a
transcript-known or manually entered character, or Narrator. Corrections carry user provenance and
leave every other line untouched.
The accepted overview groups unchanged AI speaker and prose decisions into one modest AI-assisted
count; manual overrides are excluded rather than credited to the model.
If structure could not be separated, they explicitly accept narrator-only output or keep refining the
formats. Unresolved overlaps and interrupted turns block acceptance. This review is distinct from the
next wizard phase.

## Artifact and gate

The accepted Dialogue revision contains every source interval exactly once as narration or dialogue,
with stable IDs, exact source/spoken ranges, literal labels, speaker status, regex/model/user provenance
and fallback policy. It reconstructs the accepted extraction exactly. Review and rendering consume
this artifact directly; no later phase reparses source text.

## Tests

- built-in bracket, quote, dash, screenplay, multiline, guillemet and CJK regexes;
- ordered raw regexes, toggles, deltas, overlaps and malformed patterns;
- same-rule interruption choices for bundled and concrete custom matches;
- clean asymmetric-delimiter continuation across blocks/pages and straight-quote negatives;
- configurable open-speaker markers;
- inline mixed paragraphs and narrator-only inseparable regions;
- focused single-answer attribution without model-facing IDs;
- bounded windows that safely cross block/page boundaries without changing ownership;
- transactional retries and unresolved semantic results;
- exact source partition/reconstruction;
- Public-domain explicit-format and mixed-prose fixtures.
