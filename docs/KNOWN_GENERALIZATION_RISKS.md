# Current coverage and review boundaries

Meowdiobooks makes conservative, reviewable decisions over an immutable source. This reference
distinguishes implemented handling from the cases where the current result requires human judgment or
falls back to narration. It is a product-coverage document, not a development roadmap.

The [wizard detection matrix](wizard/DETECTION_MATRIX.md) is the detailed contract for detection,
severity, user actions, downstream behavior and required proof.

## Dialogue and speaker identity

| Case | Current handling | Boundary |
|---|---|---|
| Explicit speaker formats | Built-in and user-configured patterns create exact source-anchored dialogue ranges. | Unusual, nested, or inconsistent conventions can be missed. Detected counts are not presented as total dialogue recall. |
| Speaker named in nearby prose | A detected unlabelled quotation can be attributed from bounded neighboring context, including across page or extraction-block boundaries. | The model does not search the full book. Distant attribution, delayed speech tags, and evidence outside the window can remain wrong or unresolved. |
| Undefined or deliberately hidden speaker | Configurable markers such as `???` remain unresolved; the user may request focused attribution or accept narrator fallback. | Missing evidence stays `?`. The system does not invent a cast identity to make the roster look complete. |
| Quotation that is not speech | A focused result can classify the quotation as narrator prose, preserving the intact containing text. | Thoughts, citations, signs, nested quotations, and spoken lines remain semantically ambiguous and require review. |
| Aliases, titles, and descriptive labels | Reviewed labels can map to one durable identity; reciprocal evidence is combined conservatively and conflicts block progression. | Plot-dependent aliases and late identity reveals may not be inferred. Fuzzy similarity is evidence, not authority. |
| One label used by different people | A literal label maps to one accepted identity across the book. | Reused labels such as `Guard` referring to different people in different scenes cannot be disambiguated per occurrence. |
| Editorial, collective, and group labels | Labels can be classified as character, group, editorial text, or unresolved marker. | A descriptive label that later resolves to a named person still needs human reconciliation. |
| Simultaneous speakers | An accepted group can use a dedicated voice or a user-confirmed layered route of existing character voices; Generate synthesizes those members separately and mixes one timeline event. | Exact connector-name matches are suggestions only. Partial overlaps, interruptions, staggered starts, changing members under one label, and scene-level timing are not inferred from prose. |
| Overlapping detector matches | Conflicting claims over the same source range are shown and block acceptance. | The user must disable, reorder, or refine the relevant format; priority does not silently discard a true conflict. |

There is no unrestricted full-book AI discovery fallback. If a dialogue range cannot first be separated
safely, the user can refine a deterministic format or keep the complete region narrator-read. Source
text is not silently removed to create a cleaner transcript.

## Character voice continuity

| Case | Current handling | Boundary |
|---|---|---|
| Stable character | Every accepted playable identity pins one reviewed voice reference used throughout the book. | Mechanical consistency does not guarantee an artistically appropriate performance. |
| Character changes age, body, disguise, possession, or vocal state | The character remains the same durable identity and keeps the same accepted voice. | Voice variants within one identity are not modeled. A transformation such as an adult character becoming a child does not change synthesis automatically. |
| Emotion or delivery changes by line | The current Enrichment step is an explicit pass-through; its UI previews future state metadata without running an enrichment job. | Current synthesis has no per-turn state input, so it does not change pitch, pacing, emotion, whispering, shouting, or other delivery per line. |
| Narration style or point of view changes | Narration uses one accepted narrator identity and voice. | Multiple narrators or chapter-specific narrator voices are not represented automatically. |
| Voice description appears far from representative speech | Voice suggestions use structurally adjacent narration and representative target speech. | Distant physical or vocal descriptions can be missed; the suggested settings remain editable and audition review is required. |
| Uploaded voice sample | A clear 3–30 second WAV, MP3 or FLAC clip can become a book-scoped cloned voice. Qwen3-ASR drafts the transcript with automatic language detection, and the user corrects it before Qwen Base clones the audition and later book text. | The ASR draft is not authoritative; noise, music, overlapping speakers, code-switching, names and unusual pronunciation can be wrong. Speaker similarity remains model- and sample-dependent, so transcript and audition review are required. |

## Documents, language, and audio

| Case | Current handling | Boundary |
|---|---|---|
| Text-based PDF | Users can compare extraction strategies and inspect page provenance, empty pages, suspicious extraction, reading order and repeated matter. Exact Dialogue coverage is a recovery invariant, not a content-quality claim. | Non-empty extraction cannot prove that every visual region was captured correctly. |
| Image-only, malformed, multi-column, or layout-heavy PDF | The UI can surface available extractor evidence and page previews. | There is no complete OCR/layout recovery path; reading order and missing text require representative page inspection. |
| Language selection | Detection proposes a language and the user accepts a language supported by the selected voice model. | One synthesis language is selected for the book. Code-switching and per-line language changes are not modeled. |
| Chapter and peripheral-matter detection | Chapter headings, repeated headers, page numbers, explicit web addresses, footnotes, and peripheral matter produce source-linked review evidence. | Ornamental or implicit boundaries, bare or line-wrapped web addresses, and unmarked peripheral text can be missed or over-detected. |
| Generation and replacement | Chapters publish atomically; failed or interrupted replacements keep the last playable revision. Stale inputs remain explicit. | Generation is serialized, chapter-scoped, and can take substantially longer than playback. An interrupted chapter restarts rather than resuming mid-chapter. |
| Output quality | Exact accepted voice and input revisions make routing reproducible; WAV chapters and current audiobook exports remain source-linked. | Synthesis quality is stochastic and model-, language-, and hardware-dependent. Listening review remains required. |

## Review remains part of the product contract

Meowdiobooks prevents several mechanical failures—missing source coverage, conflicting ranges,
unaccepted identities, missing voice references, partial chapter publication, and stale M4B input—but
it cannot mechanically prove literary interpretation or performance quality. Dialogue attribution,
identity reconciliation, voice selection, and final audio are accepted by the user.
