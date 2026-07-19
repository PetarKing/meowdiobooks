# Meowdiobooks wizard contract

Status: approved implementation contract.

This document defines the high-level product flow. Detailed behavior, submit processing, review,
artifacts, gates and tests live in the [`wizard/`](wizard/README.md) specifications.

## Product promise

Meowdiobooks turns one accepted local extraction into an inspectable, versioned and playable
audiobook. Source text remains immutable. Every accepted interpretation stays tied to exact source
ranges. The renderer consumes accepted dialogue and identity artifacts directly; it never reparses
the source with a hidden fallback grammar.

The core wizard is:

```text
Extract
  -> Dialogue
  -> Review
  -> Cast & Voices
  -> Enrichment (optional)
  -> Generate
  -> Export
```

Selecting **Import PDF** on Create is pre-wizard intake: the application validates, hashes and stores
the local source, then opens Extract as Step 1. Intake is not a revisitable wizard phase.

## One concrete book through the pipeline

Suppose the PDF contains:

```text
Dr. Vey: [Stay still.]
“I heard something,” Mara whispered.
```

The phases transform it without hiding ownership:

Before the wizard, **PDF intake** stores the exact PDF bytes and hash. **No AI.** The visible phases are:

1. **Extract** produces page/block text. **No AI.**
2. **Dialogue** deterministically captures `Dr. Vey` and may ask Qwen who speaks the unlabelled quote
   if the user enables focused attribution. The accepted result owns exact source ranges.
3. **Review** resolves a small set of source-quality warnings and chapter starts with explicit user
   actions. **No AI.**
4. **Cast & Voices** asks Qwen about each literal label, the user confirms identities, and Qwen suggests
   editable voice settings. VoiceDesign produces designed auditions; alternatively, Qwen3-ASR drafts
   an uploaded sample's transcript for user correction and Qwen Base produces a cloned audition. The
   user accepts exact WAV/reference revisions.
5. **Enrichment** currently publishes an explicit skipped revision. Its bounded state/scene contract is
   implemented for future evaluation but is not enabled in the product UI.
6. **Generate** prepares or reuses one cached final recording script, deterministically resolves its
   accepted text and voices, then Qwen Base synthesizes selected chapter audio.
7. **Export** packages selected current chapter WAVs as a high-quality M4B, smaller M4B, or ordered
   MP3 chapter ZIP with export-only title, author and cover settings. **No AI.**

At no point can a model silently change the PDF, source ranges, durable character IDs or accepted
voice revisions. Detailed prompt/input/output examples live in each linked phase specification.

## AI boundary at a glance

```text
Deterministic only:  PDF intake → Extract → Review → recording-script/render-plan compilation → Export
Optional text AI:   Dialogue attribution
Future text AI:     Enrichment contract (not enabled in the current UI)
Required in Cast:   label classification → voice suggestion → VoiceDesign or sample-cloned audition
Optional in Cast:   Qwen3-ASR editable transcript draft for an uploaded sample
Required in audio:  Qwen Base synthesis during Generate
```

Every semantic model result is reviewed before acceptance. PDF intake accepts verified bytes directly;
Extract uses pre-run page previews and publishes the complete run atomically; Generate publishes only
a complete playable chapter, which is then reviewed by listening. The dedicated **Review** phase is
different: it resolves empty-page, suspicious-extraction, reading-order, repeated-matter, page-number,
footnote and front/back-matter warnings after Dialogue has been reviewed. A source-coverage invariant
failure routes to upstream recovery rather than becoming an eighth warning category.

## Non-negotiable invariants

1. The imported source and accepted extraction are immutable revisions.
2. No source text is silently omitted. Thoughts are either captured as character speech or remain
   inside narrator-read prose. Material is never skipped by inference.
3. Dialogue regexes identify source ranges and literal labels; they do not create durable character
   identities.
4. The Dialogue phase shows which built-in and user regexes matched, representative evidence and
   exact result deltas. The user can enable, disable, reorder and add raw regexes.
5. Open-speaker labels are configurable source conventions. `???` is one possible literal marker,
   not the internal identity of uncertainty.
6. Dialogue AI receives only detected unresolved/unlabelled dialogue target IDs, their source text and
   bounded neighboring context. It does not receive an invented list of known characters, narration
   targets or the complete book.
7. An AI run is transactional: every requested ID returns exactly one valid row or no new revision is
   published. A structurally valid unresolved result remains allowed.
8. Dialogue result review happens before acceptance. AI-checked lines expose only the reader choice:
   a character or Narrator. Internal dialogue-versus-narration segmentation is not presented as a
   second Narrator option. Accepted Dialogue spans become the sole input to Review, Cast and rendering.
9. Cast classification happens only after all literal labels have been gathered. Qwen receives one
   focused dossier plus a bounded shortlist of similar labels with evidence. Code combines reciprocal
   certain relationships, chooses one confirmed source label as primary, and leaves possible or
   one-sided relationships for user review. A Review-only change reuses the accepted Cast by default;
   the user can explicitly reclassify from accepted Dialogue without overwriting the previously accepted
   Cast revision. The new candidate must still be accepted.
10. Enrichment is optional, separately versioned and incapable of changing text, dialogue boundaries,
    speakers or identities. Its one turn-level state represents both emotion and avatar state.
11. Generate owns one faithful final recording script. It is prepared on first entry, cached by exact
    Dialogue/Review/Cast/Enrichment revisions, and rebuilt only when those inputs change.
12. Generation is transactional and chapter-scoped. Failed replacement work never deletes the last
    playable chapter revision.
13. Export never generates speech. It packages only explicitly selected current chapter WAVs, and its
    metadata overrides never modify the PDF, chapter audio or accepted artifacts.
14. The clean implementation has no legacy analysis renderer, source reparsing, compatibility data or
    silent fallback to obsolete artifacts.

## Dialogue processing

After deterministic regex scanning and preview, the result follows one of two paths:

1. **Focused attribution** — deterministic formats separated dialogue. Qwen processes only configured
   open-speaker turns and unlabelled dialogue candidates; explicit labels and narration remain locked.
2. **Narrator fallback** — unresolved detected dialogue is read by Narrator. If no enabled format
   separates dialogue at all, the source remains narrator-read.

There is no full-book AI fallback. Qwen cannot be used to make an unstructured book appear fully
classified.

## Dialogue and narration contract

The required rendering distinction is deliberately small:

- `dialogue`: a character, group or unresolved-speaker policy owns the accepted spoken range;
- `narration`: the narrator owns the complete accepted range.

Thought is not a required rendering kind. If captured as dialogue it uses the accepted character
voice; otherwise it remains in narrator-read prose. Nothing is inferred as permanently non-spoken.

Every span retains:

- stable ID and accepted extraction revision;
- exact source range and optional spoken subrange;
- literal source speaker label, if any;
- regex/Qwen/user provenance;
- dialogue or narration role;
- explicit, AI, user-corrected or unresolved speaker status;
- nullable durable character ID after Cast reconciliation;
- accepted narrator/group fallback;
- optional enrichment revision and state.

## AI context and output

Durable source IDs never burden the model. Each focused prompt contains exactly one target:

```text
BEFORE
Subaru: Where is she?

SPEECH
Right behind you.

AFTER
Louis stepped from the doorway.
```

The compact result is:

```text
Louis
```

The base check returns exactly one speaker name, `?` for spoken-but-unknown, or `/` for not-spoken.
For local attribution, a proposed name or `/` triggers an independent verifier over the exact same
focused prompt. Remote attribution uses two differently framed checks over the same ordered bounded
passage. A name is kept only when the required checks agree after case/whitespace normalization and
have literal support. A phrase is folded into narration only under the applicable consensus rule;
disagreement stays unresolved for review. Neither path repeats source text, invents offsets or changes
deterministic source ownership.
The application maps the final answer to the single durable target it already owns.

Focused windows are bounded and may include adjacent spans across paragraph, extraction-block and page
boundaries. Crossing those storage boundaries supplies conversational evidence; it never changes
durable source ownership.

## Detailed phase specifications

- [Overview and phase index](wizard/README.md)
- [01 — Extract](wizard/01-extract.md)
- [02 — Dialogue](wizard/02-dialogue.md)
- [03 — Review](wizard/03-review.md)
- [04 — Cast & Voices](wizard/04-cast-and-voices.md)
- [05 — Enrichment](wizard/05-enrichment.md)
- [06 — Generate](wizard/06-generate.md)
- [07 — Export](wizard/07-export.md)
