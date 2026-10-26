# Adjacent-block word review

Review checks eligible touching word edges in adjacent extraction blocks through the existing
Decisions provider. It uses batches of ten independent questions, a minimum selected probability
of 0.75, and a separate verification question at the same threshold. The finite choices are a
space, a joined word, a retained compound hyphen, no continuation, or uncertainty. Model text is
never an unrestricted replacement.

Verified suggestions appear in the existing AI suggestions category. Users can apply or keep each
one, and bulk apply preserves prior manual choices. Uncertain and non-continuation rows default to
keep, including in preview and acceptance. A kept boundary preserves the previous renderer's
behavior; it does not claim that the original text is correct.

Two exact source anchors and the choice/verification evidence survive Review acceptance.
Recording scripts persist accepted seam repairs separately from immutable source entries. Rendering
revalidates adjacency, spelling, source ranges, chapter and speaker compatibility. A changed or
conflicting source fails explicitly. Transcript preview projects the same repair without rewriting
extraction or dialogue. Chapter splitting keeps an approved pair together. Effective audio recipes
change when a correction changes the spoken text.

The first version intentionally uses raw adjacent blocks. It does not skip footers, infer layout
projection, process already-spaced non-hyphen edges, or offer known layered-speaker seams. It avoids
competing repairs of the same middle token across consecutive tiny blocks. Other cleanup suggestions
retain ownership of overlapping source; the boundary row falls back to keep. A later Cast change to
a layered voice route requires resolving any incompatible accepted seam before recording. Existing within-block
hyphen review remains responsible for its existing cases. Combining marks remain part of their
original words and source offsets.

## Reproducible verification

Synthetic tests cover source/evidence tampering, malformed model responses, confidence abstention,
Unicode marks, compatible narration/dialogue seams, exclusions and competing edits, chapter splits,
transcript projection, cache compatibility and audio invalidation. Browser coverage exercises manual
keep, bulk apply, uncertainty defaults and transcript navigation. All three public-domain evaluation
PDFs preserve their exact source partition and baseline render output without accepted repairs.

The private five-book evaluation compared batch sizes 1, 8, 10, 15 and 20 over three repeats with
frozen independent source labels. Batch ten was selected for low overhead. The shipping raw-block
detector found 35 eligible boundaries in one book; the other four had no eligible raw boundaries.
Across three production-path runs, the same 22 suggested corrections matched the frozen labels,
with 0.85–1.10 seconds elapsed per affected book. This measures a small labelled sample, not a
universal accuracy guarantee. Footer-projected lab cases are not counted as production coverage.
Private source excerpts and provider configuration are not included in this repository.
