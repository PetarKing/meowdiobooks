# Phase 6 — Export

## Purpose

Package selected current chapter WAVs as a portable M4B or single MP3 without
regenerating speech or changing any accepted book artifact.

## Phase contract

```text
Input:  selected current chapter IDs/revisions + export-only title, author, cover and format preset
Work:   validate current revisions → order by accepted book structure → encode/package with FFmpeg
Output: one durable M4B or MP3 in the local Library, plus an immediate download
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
- a compact cover picker for any PDF page or the built-in audiobook cover, with an optional PNG, JPEG or WebP override;
- three allowlisted output choices with a live approximate size: high-quality M4B, smaller M4B, or
  one MP3 containing the selected chapters;
- one explicit create action whose label reflects the selected format;
- a top-level **Library** where completed exports can be opened or shown in Finder.

## Processing

After submit, the application:

1. validates that every selected chapter/revision exists and is still current;
2. rejects duplicate, stale or unknown chapters instead of silently substituting audio;
3. applies non-empty title and author overrides, otherwise retaining PDF/book defaults;
4. validates the selected PDF cover page, or an optional PNG, JPEG or WebP override no larger than 20 MB;
5. orders the chapters by the accepted book structure;
6. validates the selected allowlisted preset and invokes FFmpeg in a request-scoped temporary directory;
7. copies the complete M4B or MP3 into the configured local Library directory;
8. indexes it for the Library tab, returns the download, and removes only temporary packaging files.

Export does not persist a new semantic revision or mutate the PDF, chapter WAVs, accepted metadata or
generation pointers. A partial chapter selection is valid and produces a filename marked as partial.

See [audiobook export](../M4B_EXPORT.md) for codec, chapter-marker, metadata and failure details.

## Tests

- selection contains only current generated chapters;
- book-order packaging regardless of request order;
- stale, duplicate and unknown revision rejection;
- title and author override precedence;
- custom cover type, size and request-scoped cleanup;
- PDF metadata and cover fallback when overrides are absent;
- preset-specific filenames, media types and bitrates;
- M4B/MP3 chapter markers and directly playable, book-titled MP3 output; legacy ZIP compatibility;
- persistent Library indexing without deleting generated chapter WAV revisions.
