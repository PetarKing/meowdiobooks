# Phase 3 — Review

## Purpose

Resolve still-open warnings after the Dialogue result itself has already been reviewed. This phase
protects source integrity and audiobook quality without asking the user to reread the complete book.

## Phase contract

```text
Input:  accepted Dialogue revision + deterministic warnings + Luna cleanup proposals
Work:   inspect source evidence → choose an allowed action per occurrence/group
Output: source-linked warning decisions and reviewed chapter assignments
Gate:   every blocking warning is resolved; upstream-changing choices rerun upstream work
```

Example: a repeated running header can be marked `exclude`; a suspicious empty page remains blocking
until visually confirmed or re-extracted. The PDF and accepted Dialogue evidence are never silently
rewritten.

## AI cleanup scan

Review sends bounded spoken-text windows and nearby context to the `gpt-6-luna` Decisions API.
Flagged or uncertain windows receive a Luna repair pass. Exact source-linked corrections are shown
in the AI cleanup category; nothing changes until the user accepts the review. Unsupported or unsafe
repairs remain source checks. Review does not guess characters or change speaker assignments.
Deterministic warnings, previews and decision validation remain local. Provider failures leave a
retryable candidate failure, and coverage recovery skips the model pass.

## Scope

Review deliberately exposes a small, consequence-oriented warning vocabulary:

- empty extracted page;
- suspicious extracted text (including anchored OCR/extractor corruption evidence);
- reading order;
- repeated page matter;
- page number;
- web address;
- footnote;
- front or back matter;
- AI cleanup.

Chapter starts remain a separate binary decision because they assign chapter ownership rather than
change delivery. Internal detector codes and near-duplicate categories are normalized into the
warning types above.

Web-address detection is conservative: explicit `http://`, `https://`, and `www.` forms are
source-anchored for a keep-or-exclude decision. Sentence punctuation immediately after the address is
not included. When a web address sits inside a broader warning such as a footnote, the narrower
web-address decision controls only that exact range and the broader policy controls the surrounding
text.

Warnings that require changing Dialogue link back to a new Dialogue revision rather than mutating the
accepted transcript invisibly.

Footnote evidence remains source-exact. Inside an explicit `Translation Note(s)`, `Translator's
Note(s)` or `TL Note` section, a numbered footnote owns its wrapped physical lines until the next
footnote marker, blank separation or known section boundary. An unfinished note may continue into the
immediately adjacent source block or page. Isolated footnote-shaped lines outside that evidence keep
their original line-only range rather than absorbing uncertain prose.

## User sees

- warning groups with severity and occurrence counts;
- exact source plus adjacent context;
- proposed change and consequence preview;
- next/previous occurrence navigation;
- actions supported by that warning type only;
- unresolved, all and resolved filters;
- accepted decision provenance and superseded revision history.

## Submit and processing

Decisions such as keep, narrate or exclude are validated locally. There is no defer action: every
surfaced warning receives an explicit decision. Problems that require source or Dialogue changes
return to the relevant upstream phase and require a complete new candidate.
Proposal-backed findings offer **Apply correction** or **Keep original text** per occurrence.
Corrections for an already detected issue appear with that finding instead of a duplicate AI warning.
The decision queue's **Apply all corrections** action selects every correction, including proposals
previously kept. Source checks without a correction still need individual decisions. Accepted corrections
change rendered text while retaining original source evidence and speaker assignments.

Every warning group receives an explicit policy. A result may apply per occurrence or to a previewed
set of identical matches. A failed Extraction-to-Dialogue coverage invariant is not presented as a
content warning and cannot be waived: Review stops in a recovery state, recommends rebuilding
Dialogue, and offers a new Extraction only when the extracted source itself is wrong. The successful
Extraction revision remains accepted throughout.
An empty page remains blocking until the user visually confirms it is intentionally blank or reruns
Extract. Accepted `narrate` and `exclude` decisions execute as source-linked render policies; they are
not decorative receipts.

## Result review

Initial entry exposes an explicit Scan action. Returning through **Change settings** on an
accepted Review starts one nonpublishing candidate scan and shows in-page progress. A failed scan
leaves Retry. The accepted revision remains active until the new candidate is explicitly accepted.

Before acceptance, the user sees the full consequence delta: affected spans, narrator/character impact,
source reconstruction and downstream invalidation. After acceptance, the same evidence, decisions and
history remain available from the book.

## Artifact and gate

The accepted Review revision references one accepted Dialogue revision and records warning decisions
without replacing its source evidence. Cast cannot start while blocking warnings remain unresolved.

## Tests

- every current warning detector and executable action;
- bounded Decisions and repair requests, failure recovery and no character/speaker guessing;
- exact repair provenance, source preservation and recording-script application;
- per-occurrence and previewed bulk decisions;
- source reconstruction and Dialogue revision linkage;
- wrapped and adjacent-page footnotes, plus chapter/list negative boundaries;
- standalone and nested web addresses, including trailing-punctuation boundaries;
- durable history and post-completion inspection;
- no silent default action.
