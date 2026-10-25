# Cleanup review

Review combines deterministic source checks with a **Luna Decisions API pass** and **Luna repair
proposals**. Local installations, the public application, and hosted compositions use `gpt-6-luna`
for both remote passes. No local decision model is selected or silently used as a fallback.

## User decisions and source ownership

Review shows exact source text, its suggested replacement, and a reason. When deterministic checks
already identify the same source issue, the correction appears with that existing finding instead of
creating another AI cleanup finding. Matching requires an exact source range, an unambiguous contained
source check, or a correction whose unchanged surrounding text can be removed without changing the
edit. Ambiguous overlaps remain separate evidence rather than discarding a correction. Additional
findings appear in AI cleanup. Users can keep a
passage, apply a correction individually, or apply all corrections from the decision queue. The bulk
action also changes previously kept proposals to apply; individual choices remain editable. A flagged
passage without a safe proposal remains available for source inspection and extraction recovery.
Nothing is silently accepted because a detector or repair model was confident.

Accepting a repair changes the recording text derived from the accepted Review revision. The original
extraction, dialogue source, source offsets, and prior revisions remain intact. Each repair is tied to
its exact source range and replacement. A deletion can remove real story content even when its anchor
is exact, so users should inspect proposals before accepting them. The transcript preview includes
selected repairs before publication.

## Runtime contract

The configured Luna profile supplies the endpoint and credential variable. Local operators configure
`OPENAI_API_KEY` in their environment or repository-local ignored `.env`; hosted compositions supply
credentials from their own secret store. Do not put hosted credentials in the public checkout.
Starting Review sends bounded book text to the configured remote API and incurs provider usage.

The detector receives at most 1,200 target characters and 180 context characters on either side.
Context can include adjacent extraction blocks, which matters for isolated footer blocks. Every
editable target stays inside one accepted spoken range; paragraph boundaries are preferred and large
paragraphs are split at whitespace where possible. Context is evidence, never editable target text.

Two Decisions questions check for production artifacts and mechanical extraction damage. Only flagged
or uncertain targets proceed to Luna's low-reasoning repair pass. The implementation allows four
requests in flight, checks cancellation before each physical request, and uses the same admission,
retry, usage-observation, and settlement hooks as other remote workflow operations. Decisions has no
generated output tokens; its conservative admission metadata reserves one output token at a zero
output-token rate. Repair requests have a 2,048-output-token bound.

A proposal may contain at most eight edits. Each source anchor must be unique, at most 400 characters,
inside the target, and non-overlapping. Non-deletion replacements must be demonstrable whitespace,
line-hyphen, known encoding, or control-character transformations. Arbitrary lexical or punctuation
rewrites become source-review findings. These checks limit what a model can propose; they do not prove
semantic correctness. Missing words require source review rather than invented reconstruction.

Incomplete Decisions answers, transport failures, and unreadable repair output fail the candidate;
they are not recorded as clean text. Rejected repair anchors remain visible as source-review findings.
A failed or canceled job publishes no candidate and preserves accepted work. Retrying can incur
additional usage for requests the provider already processed.

## Experiment and verification

An October 2026 private pilot used 78 cases with paired paragraph and shorter windows (156 targets),
split between development and held-out evaluation. Cases combined permitted local book excerpts,
derived clean controls, and synthetic examples. The paired windows are correlated; this is a small
regression corpus, not an independent production-quality estimate. Some source pages had appeared in
prior scans, so the held-out split is not a fully unseen-book evaluation.

After the deterministic improvements, Decisions caught 7 of 13 remaining held-out paragraph defects
with 1 false flag among 25 clean paragraphs. The previously selected local 4B decision model caught
5 of 13 with 2 false flags. Shorter windows changed both the defect population and some outcomes;
the evidence did not establish a universally superior window size. The local route remains an
experiment only.

In the repair pilot, Luna completely repaired 25 of 36 repairable windows without reasoning and
27 of 36 with low reasoning under the evolved mechanical guard. The low setting handled missing
source more consistently, but it also proposed deleting a marker inside a quoted story sign. The
mechanical guard did not detect that semantic mistake. This is why shipping behavior creates
reviewable proposals rather than automatically rewriting books. Guard changes were made during the
experiment, so these figures are diagnostic results rather than a final held-out validation.

A live verification of the shipping module processed all 165 windows from the supplied Alice,
Pride and Prejudice, and Ah Q public-domain samples, plus 16 known-defect windows from two locally
held books. The final pass proposed three public-sample metadata removals and left two passages for
source review. It proposed 13 repairs in the targeted set, left one credit block for source review,
and missed two publisher footers that the deterministic rule detects. This 181-window run used 200
provider requests, took about 23 seconds across the five serial book checks, and cost an estimated
$0.0146 from reported usage. These timings are one observed run, not a service-level guarantee.

Adding neighboring extraction-block context helped the isolated-footer test: four of six footers
were flagged versus two of six without that context. Other outputs also varied between runs, so this
is evidence for retaining context and deterministic checks, not a controlled accuracy estimate.
Manual inspection found a credit deletion that also included its adjacent decorative separator;
this further supports keeping deletion proposals subject to user review. Lab acceptance/rendering
preserved all original source strings and attached each changed recording span to an accepted repair.

The public tests contain synthetic fixtures only. Private book files, credentials, experiment
manifests, and raw model outputs do not belong in this repository.

Run the source, guard, transport, and downstream regression checks with:

```bash
uv run pytest tests/backend/test_cleanup_remote.py tests/backend/test_cleanup_regressions.py \
  tests/backend/test_remote_llm.py tests/backend/test_review_v2.py tests/backend/test_cleanup_review.py \
  tests/backend/test_recording_script.py -q
uv run ruff check src/meowdiobooks tests
```

For a credentialed integration check, import a permitted book, accept extraction and dialogue, start
Review, inspect the AI cleanup category, select individual and bulk proposals, preview the transcript,
and accept Review. Verify the subsequent recording script contains only selected replacements and
still records original source evidence. Exercise a failed request and retry as well as the successful
path. Repeat the supplied public-domain sample matrix before release; retain raw private verification
outputs in the consuming application's ignored operator-data directory.

API behavior and pricing references: [Decisions](https://developers.openai.com/api/docs/guides/decisions)
and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
