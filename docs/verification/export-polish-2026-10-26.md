# Export polish verification — 2026-10-26

Scope: shared export packaging, built-in cover selection, and existing Library presentation.
Hosted storage, download MIME types and private runtime policy stay in the companion repository.
No new runtime dependency, provider call, schema migration, or speech generation is introduced.

## Behavior and evidence

- `mp3` produces a single `audio/mpeg` file named from the export book title. Partial selections
  retain the existing “selected chapters” suffix. ID3 title/album use the book title; chapter titles
  remain chapter markers. Legacy `mp3-chapters` ZIP requests and records remain supported.
- Real FFmpeg/ffprobe tests cover one and two chapters, duration, embedded cover, book title,
  author, album, chapter order, full decode, and non-ZIP output. Failure tests cover timeout,
  encoder failure and empty output with no partial file returned.
- An independent synthetic three-chapter check decoded exactly 3.0 seconds with dominant tones
  330, 660 and 990 Hz in that order. This supplements the automated silence-based metadata tests.
- The built-in cover is a deterministic 600×800 RGB book-and-headphones illustration. It is used
  for text/EPUB, explicit `coverPage: 0`, and local PDF-render fallback. Hosted document rejection
  still fails closed. Custom cover upload has precedence.
- API tests exercise multipart `coverPage: 0`, authenticated-book lookup, default-preview bytes
  matching packaged-cover bytes, and both local and host processor paths.
- Browser inspection exercised the real Export page against synthetic fixture data: PDF → default
  cover → PDF, MP3 selection and action copy, chapter selection, and the complete rendered layout.
  A temporary fixture supplied the actual generated cover bytes for visual inspection. Source-page
  rendering itself is covered by the API tests. The fixture's automatic navigation encountered a
  remembered workflow location; manual navigation reached Export and completed the checks.

## Commands and results

macOS, Python 3.12 with the companion development dependencies, Node/npm lockfile installation:

- `PYTHONPATH=src python -m pytest -q -m 'not uses_audio_decoder and not runs_models' tests/backend`:
  1,019 passed, 3 deselected in the combined release-polish checkout.
- Targeted export/API/import/command-runner suite: 97 passed, including real FFmpeg.
- `npm --prefix frontend test`: 519 passed in the combined checkout.
- `npm --prefix frontend run build`: passed; existing bundle-size warning.
- `npm --prefix frontend run lint`: no errors; existing LanguagePicker fast-refresh warning.
- `ruff check src/meowdiobooks tests`: passed.

An initial unrestricted backend run passed 1,019 tests and failed three unrelated voice-upload
checks because that Python environment does not install `mlx_audio`. The standard CI marker
exclusions above passed. No model-based generation was run or claimed.

Independent read-only export review found no blocking issues. The companion restricted-worker
check used synthetic source/audio and this core checkout as its source root; direct MP3 packaging
passed under the actual macOS sandbox.

## Release handoff

Publish an immutable workflow release from the reviewed merged core commit, then adopt its exact
commit and asset hashes in Cloud and run compatibility/end-to-end checks. Cloud also needs the
companion MP3 storage/download allowlist and button label changes. Add `mp3` to Cloud's permanent
restricted-worker preset matrix when adopting that release. This implementation does not publish,
repin, merge, deploy, or change existing accepted books or generated audio.
