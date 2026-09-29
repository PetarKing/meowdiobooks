# Security, privacy and package ownership audit

Auditor 02; 2026-09-29. **No blocking security regression found in the inspected promotion candidate.** One nonblocking package cleanup is recommended before publishing the shared UI asset.

## Inspected state

- Branch: `codex/studio-rebuild`.
- HEAD: `36e99f0fe5d76cd446e3329e200a34a1af9925ad`.
- Comparison: `origin/main` at `590bcd44016dd7236a57d6612160a9bdccb73e46`.
- The tree was already dirty. Review included the committed branch delta, relevant tracked edits (including audition append), and the two untracked disclosure/action-dock source helpers. No implementation, environment, GitHub, or hosted state was changed by this audit.
- Tracked working diff SHA-256 at verification: `4efd29a27a153db56cc04a67c79a43774405a1a8e242cb2c7d7068a8c3763772`.
- `app_v2.py` SHA-256: `4a3a25ad1d512ce590d522f7f70b3fad7b65248f1d1bf6686fcbc3e70c13c79c`.
- During final report read-back, the coordinator advanced HEAD to `9545014c8100f1e286baddc7a935c99145bffa8b` and began a merge with unresolved frontend conflicts. The backend hash above remained identical; the tests and npm inventory in this record apply to the pre-merge source, not the unresolved or subsequently reconciled frontend.

## Finding

**P3 — unused decoration expands the shared source package and dependency surface.** `frontend/src/components/SoundField.tsx` has no import or public export; its own dynamic import is the sole production-source use of `three`. `frontend/src/assets/brand/nocturne-pantheon.webp` has no production reference. Nevertheless, the `src` npm allowlist packs both: 6,754 and 168,042 bytes respectively. `three@0.186.1` remains a runtime dependency and `@types/three@0.186.0` brings additional development packages for that unused component. This is unnecessary consumer installation/package surface, not evidence of an exploit or provider call. Remove the unused component, dependency entries and rejected production asset while preserving historical evidence. The coordinator owns cleanup.

Actual `npm pack` dry-run: 89 files, 3,857,300 compressed bytes; no unexpected paths, test files, `.env`, credential or key paths. The built local `frontend/dist` contains the canonical sanctuary/canopy/mark assets and one JS/CSS application bundle, with no Three.js chunk or rejected Nocturne artwork.

## Boundary results

- **Source/media:** optional source-page, Library-cover and layered-preview resolvers remain explicit `WorkflowGateway` methods. Local fallbacks remain local HTTP routes. Resolver receiver binding and original resource identity passed tests. Resolvers return display/media URLs; they neither publish accepted state nor select provider routes. Hosts remain responsible for authorizing and resolving their own media URLs.
- **Audition ownership:** `_append_voice_auditions` copies old candidates, ignores adapter replacements for known revisions, and adds new candidates chronologically. The adapter receives a deep copy. Executed regression proves prior JSON/audio, default choices and the accepted Cast survive new auditions and a provider failure; an unavailable selection is refused. Acceptance remains explicit and checks exact Dialogue/Review/recipe revisions.
- **Retention/trusted paths:** append creates metadata only; it does not construct deletion paths from adapter values. Existing retention enumerates WAVs under the destination package's `voices` directory and compares revision names, including reference WAVs. Its implementation is unchanged from the base. Replacing Cast does not touch chapter audio or independent Library exports. Providers and the local package tree remain trusted composition inputs; this audit does not claim a hostile-filesystem sandbox.
- **Export/Library:** the only new persisted export field is optional, length-bounded `description` (2,000 characters). It flows through transport, packaging and the Library receipt without auth/tenant/account identifiers. M4B metadata is escaped; MP3 metadata uses subprocess argument arrays. Current exact chapter receipts and stale-audio gates remain authoritative. Executed tests cover export overrides/oversize rejection/backward readability, independent Library survival after deleting a working book, and durable-hook failure/retention ordering.
- **Injection/privacy:** manuscript excerpts, source context, identity names and bibliographic metadata use React text/value attributes. No `dangerouslySetInnerHTML`, `innerHTML`, HTML parser, eval or injected script path was introduced. The existing hostile-markup SourceExcerpt regression passed. Appearance/disclosure/dock/artwork code performs local presentation work; preview audio starts from explicit playback controls. Sample transcription is initiated only after a user chooses a sample, through the existing typed callback.
- **Public ownership:** Python application/shared-workflow dependency and allowlist definitions are unchanged. Python source distribution excludes books, working state, models and audits; npm source packaging excludes tests/design-kit/Storybook/evidence. An added-line scan of the text delta (2,534,715 characters) found no private-key, GitHub/OpenAI/AWS token patterns or Cloud-specific authority patterns. This is a bounded pattern scan, not a complete secret-certification claim.

## Executed verification

All commands ran locally without network provider calls.

```text
uv run --offline pytest -q tests/backend/test_voice_retention.py tests/backend/test_voice_reuse.py tests/backend/test_distribution_contract.py tests/backend/test_m4b.py tests/backend/test_app_v2_finish.py -k 'new_auditions or prune_voice or cast_voice_revisions or reuse or distribution or metadata or package_m4b or package_mp3' -m 'not runs_models and not uses_audio_decoder'
24 passed, 22 deselected

npm --prefix frontend test -- --run src/app/mediaUrls.test.ts src/api/client.test.ts src/components/SourceExcerpt.test.tsx src/components/PresentationRoot.test.tsx src/components/CastVoiceReview.test.tsx
51 passed across 5 files

uv run --offline pytest -q tests/backend/test_app_v2.py -k 'delete_book_removes or object_backed_library or m4b_export_uses_current' tests/backend/test_m4b.py -m 'not uses_audio_decoder and not runs_models'
5 passed, 29 deselected

npm pack ./frontend --dry-run --json --ignore-scripts --offline --cache /private/tmp/meowdiobooks-security-audit-npm-cache
Exit 0; actual package inventory inspected
```

The first npm inventory attempt used the default home cache and failed with `EPERM`; retrying with an isolated temporary cache succeeded. No cache ownership/configuration was changed.

## Limits

This is source inspection plus targeted synthetic/local tests, not a live Cloud authorization, tenant isolation, provider, penetration or real-book run. No external calls were made. Binary historical screenshots/recordings were not individually inspected for private content. Fresh Python wheel/sdist artifacts were not built here; the explicit allowlist contract passed and the npm inventory was executed. Concurrent subsequent edits or cleanup need focused revalidation against the final promoted revision.
