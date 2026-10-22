# Roadmap

Meowdiobooks already completes the local path from a raw PDF to a reviewed, chaptered cast audiobook.
The next work is about making that experience easier to adopt, easier to review and useful for more
books and computers without losing its source-linked workflow.

## Easier to start

- Provide a guided installation path for the application, llama.cpp and the supported model assets.
- Simplify running the included public-domain evaluation fixtures from import through M4B.
- Make setup failures actionable without requiring users to understand the runtime architecture.

## Easier to review and refine

- Make uncertain dialogue, speaker and source-quality decisions faster to inspect and correct.
- Evaluate an optional additional AI review pass where it measurably reduces attribution mistakes
  without obscuring the original evidence.
- Improve recovery from interrupted work and reduce unnecessary regeneration when accepted inputs
  change.
- Add a small set of useful controls for pronunciation, pauses, pacing and chapter presentation after
  their effect on complete chapters is proven.

## More books and hardware

- Extend intake beyond PDF, beginning with source formats such as EPUB and plain text while preserving
  traceability from the accepted source to generated audio.
- Improve OCR and reading-order recovery for image-only, multi-column and layout-heavy documents.
- Investigate a supported Linux path, including a voice runtime that preserves the existing audition
  and generation contracts. Consider Windows after that path is stable.
- Continue improving English and Chinese handling, then validate additional languages supported by the
  selected voice pipeline.

## Hosted companion

- A hosted companion is planned for people who prefer managed setup and compute. It will build on a
  fixed workflow release rather than replacing the local source-available workflow. Scope and timing are not
  yet committed.
## How quality changes are made

Product changes are checked against redistributable public-domain samples and regression tests. The
evaluation machinery is part of engineering practice, not a separate user-facing product milestone.
