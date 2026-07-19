# Wizard phase specifications

This directory is the canonical detailed contract for the Meowdiobooks wizard.
[`WIZARD_PRODUCT_FLOW.md`](../WIZARD_PRODUCT_FLOW.md) is the high-level product contract.
The exact model inputs, outputs, call counts, retries and deterministic boundaries are documented in
the [Qwen runtime contract](../QWEN_RUNTIME_CONTRACT.md).

The cross-phase issue inventory, false-positive/negative analysis, actions, downstream consequences
and proof requirements live in the [detection matrix](DETECTION_MATRIX.md).

## Shared phase lifecycle

Semantic candidate phases follow this visible lifecycle:

1. **Configure** — the user selects methods, policies or optional work.
2. **Preview** — representative source evidence and exact consequences are shown before expensive
   work.
3. **Submit** — one version-pinned transactional job begins.
4. **Process** — progress describes real work units and estimated remaining scope.
5. **Result review** — the produced artifact is inspectable before acceptance.
6. **Accept** — an immutable revision and active pointer are published atomically.
7. **Revisit** — accepted settings, evidence, result, provenance and superseded revisions remain
   inspectable after completion.

A failed or interrupted job publishes nothing and leaves the last accepted revision active. PDF intake,
Extract, Generate and Export use narrower variants because they do not publish semantic model candidates:

- PDF intake happens before Step 1 and accepts bytes after local integrity checks.
- Extract uses page previews before the complete run, then publishes that run atomically.
- Generate compiles only accepted artifacts, then publishes a chapter only after its audio and metadata
  are complete; playback is the result review.
- Export validates selected current chapter WAVs, then returns one request-scoped M4B or MP3 chapter
  ZIP without publishing another book artifact.

## Phase index

| Phase | Input → output | AI use |
|---|---|---|
| [Extract](01-extract.md) | Imported PDF → accepted page/block text | **NO AI** |
| [Dialogue](02-dialogue.md) | Accepted extraction → narration/dialogue spans | **OPTIONAL AI** — only selected unresolved turns |
| [Review](03-review.md) | Accepted Dialogue + warnings → explicit warning decisions | **NO AI** |
| [Cast & Voices](04-cast-and-voices.md) | Literal labels → reviewed identities + accepted designed or cloned voice references | **AI REQUIRED** — text classification, voice suggestions and auditions; optional ASR draft for uploaded samples |
| [Enrichment](05-enrichment.md) | Accepted transcript/cast → explicit skipped revision; future state/range metadata contract | **CURRENTLY SKIP-ONLY** |
| [Generate](06-generate.md) | Accepted artifacts → cached recording script → chapter WAVs | **AI REQUIRED** — TTS synthesis only |
| [Export](07-export.md) | Selected current chapter WAVs → M4B or MP3 chapter ZIP | **NO AI** |

## How to read a phase contract

Each detailed phase answers the same questions:

1. **Input:** Which accepted revision or user choice may enter the phase?
2. **Work:** What deterministic code and model calls run?
3. **Output:** What candidate or accepted artifact is produced?
4. **Gate:** What must be true before the next phase starts?
5. **AI contract:** Is AI used? If yes, what prompt shape, input, output, validation and fallback apply?

“No AI” means no language model or speech model is loaded for that phase. Ordinary parsing,
validation, hashing, regexes and file conversion are deterministic application work, not AI.

## Two different reviews

Dialogue has its own result review: the user inspects deterministic/AI dialogue results before
accepting the Dialogue revision.

The later Review phase is not a second dialogue acceptance. It handles seven consequence-oriented
warning types: empty page, suspicious extraction, reading order, repeated matter, page number,
footnote and front/back matter. Chapter starts remain a separate binary decision. A malformed
Extraction-to-Dialogue coverage invariant opens a recovery route instead of masquerading as another
content warning.

## Shared evidence rules

- Source is always shown beside the proposed result.
- Every model or user decision references stable source IDs.
- Counts distinguish detected explicit labels, configured open-speaker labels, unlabeled candidates,
  regex conflicts, AI assignments and unresolved results.
- The UI never claims semantic recall that deterministic scanning cannot measure.
- Representative successes are shown alongside work requiring attention.
- User corrections outrank model output and survive reruns when their source lineage remains valid.
