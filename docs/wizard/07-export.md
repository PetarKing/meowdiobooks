# Phase 7 — Export

## Purpose

Bundle selected current chapter WAVs into one portable, chaptered M4B without regenerating speech or
changing any accepted book artifact.

## Phase contract

```text
Input:  selected current chapter IDs/revisions + export-only title, author and optional cover
Work:   validate current revisions → order by accepted book structure → package locally with FFmpeg
Output: one durable chaptered M4B in the local Library, plus an immediate download
Gate:   at least one selected current chapter; non-empty title; every WAV validates before packaging
```

## AI use — NO AI

Export uses no language, speech or image model. It packages already generated WAV files with
deterministic metadata and chapter boundaries.

## User sees

- only current, playable chapter WAVs, in accepted book order;
- independent selection of the chapters to include;
- total selected listening time;
- title and author prefilled from the imported book and editable for this export only;
- a compact cover picker for any PDF page, with an optional PNG, JPEG or WebP override;
- one explicit **Create & download M4B** action.
- a top-level **Library** where completed exports can be opened or shown in Finder.

## Processing

After submit, the application:

1. validates that every selected chapter/revision exists and is still current;
2. rejects duplicate, stale or unknown chapters instead of silently substituting audio;
3. applies non-empty title and author overrides, otherwise retaining PDF/book defaults;
4. validates the selected PDF cover page, or an optional PNG, JPEG or WebP override no larger than 20 MB;
5. orders the chapters by the accepted book structure;
6. invokes FFmpeg in a request-scoped temporary directory;
7. copies the complete M4B into the configured local Library directory;
8. indexes it for the Library tab, returns the download, and removes only temporary packaging files.

Export does not persist a new semantic revision or mutate the PDF, chapter WAVs, accepted metadata or
generation pointers. A partial chapter selection is valid and produces a filename marked as partial.

See [M4B export](../M4B_EXPORT.md) for codec, chapter-marker, fallback and failure details.

## Tests

- selection contains only current generated chapters;
- book-order packaging regardless of request order;
- stale, duplicate and unknown revision rejection;
- title and author override precedence;
- custom cover type, size and request-scoped cleanup;
- PDF metadata and cover fallback when overrides are absent;
- partial export filename and M4B chapter markers.
- persistent Library indexing without deleting generated chapter WAV revisions.
