# Audiobook export contract

## Purpose

Meowdiobooks can package a completed generation run as a chaptered M4B or an ordered ZIP of MP3
chapters. Export is a presentation step over existing immutable chapter revisions; it never regenerates
speech or changes an accepted source, cast, recording script, or render.

## User contract

Wizard Step 7, **Export**, unlocks after at least one chapter finishes successfully in Generate.

- The export contains exactly the current chapter revisions selected in Export.
- Chapters are ordered by the accepted book structure, not by request or completion order.
- A subset export is allowed and is identified as such in the UI and filename.
- Every requested revision must still be the current revision for the same generation fingerprint.
  Export fails rather than silently mixing stale audio or different render settings.
- The default `m4b-high` result uses 128 kbps AAC in an M4B container with one seekable chapter marker
  per chapter.
- `m4b-compact` uses the same M4B structure at 64 kbps AAC.
- `mp3-chapters` creates a ZIP with one ordered, tagged 96 kbps mono MP3 per selected chapter.
- The UI shows an approximate size for every preset based on selected audio duration. Cover and
  container overhead mean the final size can differ slightly.

The default UI saves the finished file to the Library and returns only its metadata before opening the
Library. It does not copy the complete artifact into browser memory merely to confirm that export
succeeded. Explicit API clients can still request the binary response. The default macOS Library location is
`~/Music/Meowdiobooks`; `meowdiobooks serve --library` can override it. Meowdiobooks does not upload,
sync, or share the file automatically.

## Metadata and cover precedence

Title and author use this precedence:

1. a non-empty Export-step override;
2. non-empty PDF metadata;
3. the persisted book title or author;
4. the source filename for the title only;
5. `Meowdiobooks` for a missing author.

Cover art uses the selected PDF page, defaulting to page 1, or an optional PNG, JPEG or WebP selected
in Export and limited to 20 MB. If that page cannot be rendered, export falls back to the square
Meowdiobooks artwork shipped with the application. Export-only metadata and cover choices never alter
the source PDF, generated WAVs or accepted artifacts.

## API compatibility

New clients submit an allowlisted `preset` to `POST /api/books/{book_id}/exports/audio`. Omitting the
preset selects `m4b-high`. The original `POST /api/books/{book_id}/exports/m4b` endpoint remains a
high-quality-M4B compatibility route and rejects non-M4B presets. Existing Library records without
preset or media-type metadata are treated as `m4b-high` exports.

## Dependency

Audiobook export requires the `ffmpeg` executable on `PATH`. FFmpeg is optional for import, review, voice
generation, WAV chapter rendering, and playback; only the export action is unavailable without it.

Install it on macOS with:

```bash
brew install ffmpeg
```

M4B export uses FFmpeg's concat demuxer, `ffmetadata`, AAC encoding, attached cover art, and MP4
fast-start metadata. MP3 export encodes each chapter with `libmp3lame`, writes ID3v2 title, album,
artist, track, genre, and cover metadata, then stores the already-compressed MP3s in book order without
redundant ZIP recompression. It runs locally and receives only paths inside the selected book package
or application assets.

## Validation and failure behavior

Before invoking FFmpeg, the backend validates:

- the book and every requested chapter/revision exist;
- no chapter is duplicated;
- each revision is current and matches the current generation fingerprint;
- every chapter WAV exists and has a positive, readable duration;
- the first chapter begins at zero and chapter boundaries are monotonic;
- FFmpeg is available.

FFmpeg writes into a request-scoped temporary directory. The response is offered only after every
encoder exits successfully, produces a non-empty artifact, and the file is copied atomically into the
Library. Temporary packaging files are then removed. Generated WAV revisions and successful Library
artifacts are never deleted by export cleanup. Failed exports leave all chapter audio untouched and
publish no partial package.

## Explicit non-goals

- No in-app deletion or relocation of Library files in the first version; Finder remains authoritative.
- No cloud delivery, Apple Books automation, or iPhone pairing.
- No lossless WAV or FLAC archive.
- No arbitrary user-entered codecs, sample rates, or bitrates.
- No generation of multiple formats from one export action.
