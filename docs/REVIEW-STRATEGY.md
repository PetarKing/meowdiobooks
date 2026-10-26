# Review strategy

Review proposes source-bound changes; it does not rewrite the book or silently remove text.
The same strategy applies in the standalone workflow and hosted compositions. Private provider
experiments, credentials and book corpora remain in the composition repository.

## One pipeline, different decisions

1. Scan the complete source locally for structural candidates. A candidate is evidence to inspect,
   not permission to edit. Language-specific heading or note hints must match complete lines.
2. Use bounded Decisions questions with nearby source context for word spellings and optional
   publishing material. Different checks have different allowed outcomes and verification routes.
3. Use Luna for bounded chapter-candidate batches and where a complete editorial unit or repeated publishing family needs verification.
   Do not ask it to invent replacement prose or executable matching rules.
4. Validate every proposal against its exact immutable source range and its decision evidence.
5. Present word/editorial suggestions together, with apply-all and individual exceptions. Keep
   each verified numbered-footer family as a separate group decision. Preserve
   uncertain text without creating a mandatory task merely because a model abstained.

## Responsibilities

| Check | Candidate evidence | Result |
|---|---|---|
| Chapters | Standalone heading shape, multilingual hints and nearby layout/text | A proposed chapter boundary; never an omission |
| Hyphens | Unicode letters split across a physical line break | Exact keep-hyphen or join-word spelling; otherwise unchanged |
| Numbered page text | Repeated page-edge label with consistent changing folios and supported geometry | One verified family of optional omissions, matched locally with individual exceptions |
| Credits and publishing text | Complete paragraphs/blocks, recurrence or bounded book-edge context | Omit only a verified whole unit; preserve mixed or incomplete units |
| Script delivery cues | Existing targeted bracket/context check | Existing preserve/narrate/delivery behavior |
| Footnotes, links, page numbers, obvious corruption | Existing local structural checks | Explicit review choices; no broad rewriting |
| Empty pages, reading order and source coverage | Extraction/partition evidence | Existing safety and recovery checks |

The former all-passage semantic scan is replaced by these focused checks. Subtle defects without a
structural candidate, such as an otherwise ordinary word with a missing space, can remain. This is
an intentional coverage tradeoff, not a claim that the remaining text was semantically proofread.

## Boundaries and preservation

A chapter heading must map to an exact source position. Never move a mid-page heading to the start
of its page. New Dialogue processing may refine source-identical narration partitions at structural
heading drafts before publication; existing accepted Dialogue artifacts are not rewritten.

A repeated credits opening and the next chapter can suggest a region, but neither proves that all
intervening text is editorial. Do not delete individual lines from a longer disclaimer or credit
list, and do not stretch a proposed region across story text to reach a heading. Unsupported,
mixed, overly large or unanchorable units stay in the text.

Model scores are routing heuristics, not calibrated guarantees. Keep typed abstentions, local
source checks, representative verification and explicit user acceptance. Repetition alone is never
semantic proof. Identical text in a different context may require a different decision.

Hyphen proposals require both an exact-spelling choice and a separate contextual verification.
The two hyphen questions may use the same model; their agreement is not statistically independent
proof. Chapter candidates use bounded Luna classification with explicit page/block context after
cheap structural exclusions; they do not depend on a lossy Decisions gate.

Numbered footers use a constrained rule discovered locally, not model-generated executable code.
Decisions and Luna inspect varied representatives once per family; eligible matching occurrences
are found locally. Unrepresented layouts and unsupported owners stay unchanged. This bounds model
work by the number of families, but a falsely verified family can still suggest repeated mistakes.

Provider failures remain retryable failures and must not publish a partial candidate as complete.
Cancellation and request admission apply to every paid call. Saved evidence binds proposals to the
source revision and supports acceptance validation without repeating inference.

## Verification

Use synthetic multilingual headings, inline-word negatives, contents pages, repeated running
headers, legitimate compound words, ambiguous interruptions, complete and fragmented credits,
and context-sensitive repeated text. Check exact source conservation through preview, acceptance
and chapter compilation, including individual exceptions after a bulk action.

Run the public-domain evaluation PDFs and full-book operator corpus. Report detection coverage,
preserved uncertain cases, unsafe or incoherent suggestions, physical API calls, usage and cleanup
latency separately. Do not equate a faster, narrower scan with equal proofreading coverage.
