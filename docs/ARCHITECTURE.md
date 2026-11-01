# Architecture and release boundary

Status: V1 architecture.

Meowdiobooks is a complete local application. The [source setup](SETUP.md) builds and installs the
API, local workflow runtime, compiled browser application, model registry, and command-line entrypoint.
No Meowdiobooks account, private repository, or database is required. Cleanup Review uses OpenAI
Luna and requires network access and an OpenAI API key; local voice generation remains local.

## Composition

The local application has four explicit layers:

1. FastAPI routes validate transport requests and translate them into workflow commands.
2. `WorkflowRunner` dispatches typed commands without depending on HTTP or the local job queue.
3. Stage handlers use `BookWorkspace` to read immutable inputs, write candidates, and atomically
   publish accepted revisions.
4. Local adapters provide PDF extraction, inference, voice audition, chapter rendering, JSON storage,
   and the serialized local queue.

The browser application follows the same split. `App` owns the public local product shell and accepts
a `WorkflowGateway`. The default `HttpWizardApi` implements that gateway. Workflow navigation, cast,
generation, dialogue, review, and presentation logic live outside the composition component.

The frontend page views in `frontend/src/pages` receive typed selections from
`app/useWorkflowModel`; the model owns workflow state and commands. Page extraction preserves
the accepted application's existing mount boundaries. Render functions invoked directly by the
shell remain hook-free; reusable stateful components mount normally inside those views.
Browser return hints retain the selected book and stable journey step independently of the active-job
marker. Return hydration fetches independent immutable candidates in parallel after the authoritative
snapshot is read; state commits only after all required reads succeed. Known scoped book/job returns
show a quiet localized status on the first render, preserving explicit Home/Library precedence.
Book decoration starts only after an 800 ms sustained wait, without
delaying workflow readiness or imposing a minimum animation duration. Reloads hydrate authoritative snapshots and pending candidates before reattaching a job, and
again when it settles; they never rerun a provider command. Review candidates reopen for inspection,
and completed extraction candidates offer explicit acceptance rather than publishing on reload.
Explicit Home/Library navigation, including an initial Library URL, wins over
a delayed restore. Missing or invalid books discard their hints; transient failures retain them with
a Retry action. Extraction previews load only when the Extract view needs them. Browser storage is
best-effort and contains identifiers, not artifacts or authority. Hosts must supply
`workflowPersistenceNamespace` per identity (and remount on identity changes) to isolate browser hints;
hosts that reload after deferred commands use `persistWorkflowReturn` from the public workflow entry.

Hosts can also supply `initialWorkflowLocation` (`bookId`, stable `stepId`, optional `activeJobId`)
on a newly mounted App. This explicit destination wins browser hints, so return links and already
dispatched jobs recover when browser storage is unavailable. It hydrates and polls only; it never
repeats work. Hosts must remount App on identity or explicit return-context changes, and keep
`onActionRequired` stable so changing unrelated host UI does not restart restoration.

Hosts may supply `generationPurchase` for purchase presentation on Generate. Its book ID,
accepted extraction/dialogue/review/cast revisions, recording-script revision, and explicit chapter IDs
must describe the host-confirmed current purchase scope. Generate applies a gold wash to the host-confirmed scope only
when these revisions match the current snapshot and its cast is accepted. Current generated audio also
uses this wash, while its visible status always describes audio readiness: Generated, Needs update
or To make. Purchase never changes that status, and no redundant Purchased badge is shown. Omission, a different book,
or a changed accepted parent removes the presentation. Existing audio never implies purchase.
Generate separates To make (the entry default when work remains) from Generated (current audio only).
Older recordings stay in To make with an independent Listen action; empty chapters remain visible
as disabled No audio rows and are excluded from its actionable count. A completed-only book opens
Generated. Tab changes clear selection. Current audio selection goes to Export. Generate is offered only for missing or outdated audio;
there is no forced regeneration action. The workflow model filters requested IDs to valid, nonempty
chapters without current audio before dispatch, tracking or estimation. Chapter readiness compares the
effective per-chapter render recipe against immutable accepted inputs, so equivalent stage reacceptance
and changes confined to other chapters preserve current recordings. Snapshot and Export use the same
canonical render-plan comparison, with a request-local cache and conservative handling of missing
history. Explicit Generate language overrides retain their existing command/receipt contract across
equivalent reacceptance; this comparison does not infer new host settings or renderer versions.
Reattaching an active Generate job holds the return notice until authenticated job scope is known,
then restores its valid requested chapters and the same locked progress presentation as a fresh run.
Missing legacy scope uses neutral progress rather than inventing an all-chapter request. Settlement
retains the initial job scope even when later polls omit payload. Partial failures select only requested
pending tracks when any remain, including tracks already published before reattachment; when no
requested pending tracks remain, current requested recordings are selected for Export.
Generation request errors appear once beside the built-in Generate action, with localized copy and
any reviewed support reference. The shell retains errors from unrelated operations, workflow-return
Retry actions, custom step views and views without that action; message text alone never determines
which surface owns an error.
This prop grants no permission and does not change generation commands or host funding checks;
account and payment records remain outside the workflow model and artifacts.

The public `cast_runtime.cast_voice_targets` helper plans required voices from finalized identities
and accepted Dialogue/Review routing without mutating inputs. Hosts use it for cost and reuse checks;
zero-line narrators are absent from these targets.

The public `cast_runtime` planning helpers `rebase_accepted_cast`, `reuse_unchanged_cast_voices`
and `has_complete_audition_pack` let compositions determine existing reuse before admitting new
provider work. They do not call providers, write files or publish artifacts. The reuse helper updates
identity IDs and label mapping in the supplied disposable finalized draft; never pass an authoritative
store record. The completeness helper checks declared planned revisions, so callers must separately
validate source availability and the current model/recipe. Existing private names remain aliases.

Host intervention is a provider-neutral boundary: a valid descriptor has `code`, public `message`,
and opaque JSON `context`. A provider exception may attach it as `action_required`; failed jobs
persist it in their existing JSON record without a new status or automatic retry. Voice transcription
and clone-upload endpoints preserve it as HTTP `detail.actionRequired` (default 409 or a supplied 4xx
status), while cleaning temporary files and retaining accepted artifacts. Malformed metadata remains
an ordinary failure. Policy and funding gates remain owned by hosts, including preflight before
retrying an existing failed job.

`HttpWizardApi` exports `ActionRequiredError` and decodes valid synchronous descriptors. App's
`onActionRequired(action, context)` receives synchronous and settled/restored job actions; job context
includes book, stage, job ID and original settings when available. Return `true` only after showing
an actionable host response. Only handled typed actions suppress global/inline error banners;
uncomposed or declined actions retain their public message. A host transport that already displayed
the action can throw `new ActionRequiredError(action, { handled: true })`. No action descriptor grants
permission, contains credentials, selects a provider or automatically replays a command. A browser
voice file stays local and requires an explicit transcript retry or reselection after navigation.

The error carries a provider-neutral brand. Use exported `isActionRequiredError` rather than
constructor identity when inspecting it: development dependency optimization or independently
bundled package entry points may create separate class instances. The guard also validates the
descriptor and handled flag, so ordinary or malformed errors still remain visible.

Background job failures use an optional `on_job_failed(job, error)` callback on `create_app_v2`
and `JobQueue`. This additive, provider-neutral seam receives the settled failed job and original
exception, including its traceback, after persistence. Without a callback, local operator logs
retain the exception with job ID, kind and attempt. A composed callback owns private diagnostic
storage and redaction; core does not duplicate its exception in logs. Callback failures produce
only a job-correlated warning and cannot leave the job running or stop subsequent jobs.
Cancellation, successful publication and valid action-required outcomes do not invoke the callback.
Explicit `public_message` values remain public; otherwise jobs return plain retry guidance rather
than exception names or diagnostics. Hosts must keep callback records outside public artifacts and
job responses. Synchronous requests and process crashes do not pass through this queue callback.
The additive `on_operation_failed(operation, book_id, error)` application hook covers caught
transcription, cloned-audition, export-packaging and export-save failures with the same private-log
ownership and reporter-failure isolation. Its operation labels are `transcribe`, `clone`, `export`
and `export-save`; it does not claim universal HTTP error coverage. Explicit `WorkflowInputError`
recovery guidance and valid host action descriptors remain public.
Public operation errors may append ` Reference: <32 lowercase hexadecimal characters>.` to one of
the reviewed audio, transcription, voice-sample, export, preview or document-read messages in
`referencedOperationErrors`. The frontend preserves only this exact message/reference pairing,
translates the base message and reference label separately, and rejects unknown or malformed pairs.
The opaque reference conveys no provider details and grants no access to diagnostic records.

Storybook exercises the same source with deterministic synthetic gateways. It is a development
surface and is excluded from the consumer package.

`PresentationRoot` owns optional semantic palette values, without changing workflow behavior.
Its roots cannot nest; full art directions use separate preview frames. The public unlayered
`product.css` entry is loaded once before host overrides; `App` does not load global CSS as a side
effect. See [the design-system contract](../frontend/DESIGN_SYSTEM.md) for ownership and compatibility.

Voice-sample transcription is a narrow best-effort boundary: the browser uploads one temporary sample,
the selected local adapter returns editable text plus an optional detected language, and neither result
is published as an artifact. The current adapter is MLX-Audio on Apple Silicon. A Linux adapter may
implement the same function and HTTP/gateway response without changing Cast UI or accepted voice data.

New Cast identity proposals make one bounded language classification from up to 4,000 characters of
the accepted spoken transcript, sampled across opening, middle and closing pages. The proposal stores
`detectedLanguage` and optional `languageProbabilities`; opening its voice confirmation performs no
inference. Scores rank offered languages and are not displayed as calibrated confidence. Saved audition
languages and explicit choices take precedence. Unsupported/indeterminate results require a choice;
unconfigured, unavailable or malformed model results retain the existing script-based suggestion.
Hosts may supply `language_detector` to select their model catalog and must bind
`language_usage_observer` / `language_request_admission` for their Cast accounting and admission policy.
These use the existing per-request lifecycle; admission/accounting failures retain host semantics.
Older immutable proposals retain their existing suggestion until a new identity proposal is created.

### Import limits

Hosts can supply `maxImportBytes` to the workflow App and `max_import_bytes` to
`create_app_v2`. Both default to 500,000,000 bytes and accept only positive integers up to
that ceiling. Format-specific ceilings (64 MiB EPUB, 20 MiB TXT/Markdown) remain in force;
the effective file limit is the smaller of the format ceiling and host setting. The App displays the effective decimal MB limit and rejects oversized files before
calling its gateway, including replacement selections. The API independently counts file bytes
before parsing or writing a book. A host must supply matching values and separately bound the
entire incoming multipart request before its parser, allowing room for multipart overhead and any
proxy limit. The UI check is a convenience, not an authorization or resource boundary.

### Untrusted PDF parsing

Hosts may supply a `file_processor` implementing `FileProcessor` to `create_app_v2`. Import inspection
and metadata, page/full-document extraction, page rendering (including the media route and export
cover), voice-sample normalization and audio packaging then run through that processor. The built-in
cover (`coverPage: 0`) is trusted, deterministic artwork generated directly without opening a source
document; it is not a fallback for rejected hosted parsing. The local
default remains unchanged. The host owns process isolation, deadlines, resource limits and validation
of untrusted worker results; this interface alone is not a sandbox. A metadata failure rejects a new
import and removes its newly written source, just like inspection failure.

A processor may additionally implement `extraction_sample_pages(source, cache_root,
page_count)` to choose preview pages using a cheap whole-PDF text/image screen.
It returns ordinary representative-page rows with optional `ocrCandidate: true`
for at most two pages. Hosts without this optional method retain the fixed
representative pages; Core never bypasses a host processor to inspect a PDF.
The screen never runs OCR. Standard extraction uses its sparse-image signals
(including footer-only pages) to recover text through the processor's `ocr` method
before building Dialogue blocks. Sparse preview pages use the same recovery helper.
A successful screen marks blank digital pages as non-candidates. When screening is
unavailable, empty extracted pages still receive a recovery attempt.

Recovery retains the original page when OCR is empty, unchanged or adds no useful
text. Errors and cancellation propagate before the Extraction candidate is written.
Recovered text then follows the ordinary Dialogue and Review pipeline; no special
narrator policy or Review recovery decisions are needed. Explicit OCR uses a distinct
cache identity. Hosted processing uses the injected adapter throughout.
An adapter may expose integer `ocr_parallelism` from one to four to recover candidate pages
concurrently during complete Standard extraction. The default is one; previews
stay serial. At most that many calls are submitted at a time, results retain physical page
order, and progress/cancellation runs on the calling job thread. On failure or
cancellation, pending calls are cancelled and running calls are joined before
returning; adapters must enforce their own inference deadlines and shared admission.

The document rendering/LiteParse and audio packaging helpers also accept an optional keyword-only
`command_runner`. Hosts can supply a callable compatible with `subprocess.run` to execute the
existing command arguments, capture/check options and deadlines through a separate execution
boundary. When omitted, helpers retain their original subprocess behavior. A supplied runner is
always used, including callable objects with false truth values; failures propagate through the
existing operation error handling without retrying an unrestricted subprocess. The host owns
command authorization and process restrictions; this hook does not itself provide isolation.

Native audition, clone, transcription and chapter rendering also accept an optional `model_loader`.
It receives the exact registry-resolved model path and `tts`/`stt` kind, and returns a model plus a
release callback. Each operation releases that lease on success or failure. A host can retain weights
between operations, but owns exclusive access and must not assume mutable MLX models are safe to
share between threads. Default acquisition still loads and releases per operation. Publication,
source coverage, recipe choice and audio assembly contracts are unchanged.

Hosts may supply `book_id_for_source` to `create_app_v2` when their store needs a different identity
namespace. The resolver receives the verified full source SHA-256 and returns a stable ID containing
only letters, digits, `_` and `-` (1–128 characters). Local content-derived IDs remain the default.
The workflow validates the ID before writing and rejects a collision with a different source hash;
the host retains responsibility for ownership and legacy-ID compatibility.

The September 2026 parser repair pins pypdf 6.18.1, pdfplumber 0.11.10 (pdfminer.six 20260107),
and lxml 6.1.3 in both application and workflow distributions. The shared parser dependency stack
belongs here so every composition receives the same fixes. Keeping the old parsers behind upload-size
checks was insufficient: an 87-byte PDF with an oversized trailer recovery range exceeded a three-second
probe deadline. The patched pypdf rejects that input in approximately 0.6 seconds on the review machine.
The regression runs in a killable subprocess and verifies HTTP 422, no imported book, and rejected-source
cleanup; normal metadata and both native/layout text extraction are also tested.

Import checks only five signature bytes before parsing. Parser-specific failures become a stable
validation error instead of an unhandled server error. This removes unnecessary signature buffering
and known vulnerable parser versions; it does not provide a general CPU/memory sandbox for arbitrary
PDF extraction. Companion deployments must consume a new immutable release to adopt the repair.
The dependency rationale also includes pdfminer's
[removal of unsafe pickle-based CMap loading](https://github.com/pdfminer/pdfminer.six/releases/tag/20251230).

### EPUB and text imports

EPUB, UTF-8 TXT, and Markdown retain the original source hash and bytes. Their deterministic
`text-v1` reader publishes the normal Extraction artifact during import, before the import hook;
the UI opens Dialogue and visibly disables Extract. Markdown stays literal. EPUB reads XHTML
in spine order (including supplementary entries), retaining paragraph boundaries and image alt
text. Long sections are split at newline/word boundaries up to 6,000 characters; section numbers
occupy the existing page fields. Review returns inert `sourceText` instead of `imageUrl`, and
export uses a generated cover or a supplied image. No source HTML is rendered or executed.

All reads retain the optional FileProcessor boundary, including its legacy PDF-named methods.
There is no host-to-local parsing fallback. ZIP members are never unpacked; paths, member count,
per-member and cumulative expanded sizes, duplicate resources, XML entities, unsupported embedded
content, invalid UTF-8 and empty text are validated. The new readers add no runtime dependencies.
Import failure rolls back new extraction artifacts and restores pre-existing artifact pointers.
PDFs requiring a non-empty opening password and protected EPUBs remain rejected.
PDFs with supported encryption that open with an empty password are accepted; the original
source bytes and hash are preserved, and the existing readers open them without rewriting.
`DocumentImportError` carries a stable `code`
(`encrypted-pdf`, `encrypted-epub`, or `unsupported-epub-compression`) and fixed public guidance;
host document boundaries may preserve these classifications without forwarding parser diagnostics.
PDF inspection uses the pinned pypdf 6.18.1 `_handle_encryption` hook, reached only after the
parsed trailer identifies encryption, to try only an explicit empty password. Password failures,
unsupported security handlers and unavailable crypto support retain the classified rejection.
The pinned provider marker and normalized stream/string/embedded-file cipher fields also gate
AES support before deferred object decryption. Malformed encryption dictionaries return the
same validation error and source cleanup as other malformed PDFs.
Parser upgrades must preserve this gate; RC4, AES, and unsupported-handler fixtures verify it.
The default UI translates only the reviewed messages, optionally followed by a valid support reference.

### Book-list fault isolation

Book discovery validates each record and workspace independently. A malformed book is omitted from
the list without reinterpreting retired stages, changing its data, or hiding healthy books. Mutations
of healthy records preserve unrelated raw records, including malformed ones. Non-book failures and
store-wide failures remain explicit errors; isolation does not turn an inaccessible store into an
empty shelf.

## Authority and publication

Remote Dialogue admits a bounded worker window and checkpoints completed independent checks and
conflict groups under a package-private exact-input fingerprint. A retry reuses validated results
only for the same source partition, target set, model, prompts and policy. These checkpoints do not
publish or accept workflow state. Malformed decisions retry within their batch, then split into
smaller target groups. A persistently unusable single-target answer remains explicitly unresolved
for human review and narrator fallback; it never creates a guessed speaker or removes source text.
Cancellation, denied admission and unrecoverable transport failures stop new work and drain active
requests. Every admitted request completes its lifecycle even on unexpected transport failures.

Compositions may set `dialogue_attribution.adjudication_remote_profile` to a registered
OpenAI Responses profile for every conflict group. The initial independent passes keep the primary
profile at low/medium reasoning; conflict resolution uses the optional profile's reasoning setting
(or high when omitted). Without an override the primary model still adjudicates at high reasoning.
Each request keeps its own profile for admission, usage observation and pricing. Changing the
adjudicator recipe invalidates conflict checkpoints while preserving completed independent passes.

Hosts may provide an initial `estimated_seconds_per_batch` duration hint. The Dialogue loader shows
a range accounting for both independent passes, configured worker count and conflict headroom,
then refines the estimate from measured progress. An estimate is not a completion guarantee.

Review combines deterministic warnings with a Luna Decisions scan and bounded Luna correction
proposals. The shared implementation and source-linked acceptance contract live in core; hosts supply
credentials, request admission and separate Review usage observers. Every edition uses Luna for this
pass. A provider failure fails the candidate explicitly without publishing partial or clean results.
The `ai-cleanup` category records an individual keep/repair/source-review choice for each occurrence.
Verified script-direction omissions use a separate occurrence-scoped category with Keep/Leave choices.
Rules find bounded bracket candidates; Decisions and a Luna preservation check must agree before a
suggestion is shown. Uncertain candidates remain spoken without individual review. Generic cleanup
cannot delete overlapping balanced brackets. Bulk acceptance expands to explicit individual choices rather than claiming different edits have
identical evidence. Accepted replacements change only rendered speech: source offsets, source text,
and speaker assignments remain unchanged. Recording scripts verify replacements against the accepted
Review snapshot before using them. See [cleanup review](CLEANUP-REVIEW.md) for limitations and setup.

The backend is authoritative for accepted state. The browser may prepare settings and decisions, but
it cannot publish artifacts or infer that a stage is accepted.

- Candidates and accepted artifacts are immutable revision files.
- A candidate may be accepted only against its exact accepted parent revisions.
- `artifacts/latest.json` is the one active stage-pointer map.
- Publishing a revision atomically replaces its pointer and removes downstream active pointers.
- Invalidation never deletes history or the last successfully generated audio.
- A failed or canceled job publishes nothing.

Cast voice profiling may use a package-private checkpoint to avoid repeating paid or remote work after
a failed attempt. Its key binds the exact accepted inputs, finalized identities, language, and
profiler contract revision. The checkpoint is neither a candidate nor accepted workflow state; it may
only be reused for an identical retry, and publication still remains atomic.

Native chapter rendering also checkpoints completed synthesis sections under the package-private
`.checkpoints/native-generation` directory. Each exact-recipe key binds the book, ordered chapter
plan, reference audio content, language, model source/revision, runtime versions, native implementation,
chunking and timing settings. Configured model paths, small configuration/tokenizer content and local
file metadata conservatively invalidate replaced installations; the registry's pinned revision remains
the authority and installed pinned weights are trusted. A verified float32 WAV and checksum sidecar
must both be complete before a section can resume. Missing, incomplete or corrupt sections regenerate;
unsafe checkpoint paths fail closed. A bounded `progress.json` snapshot records section counts,
restored counts, state and timestamps without source text. Progress advances after every persisted
section, including sections inside long narration and separate members of layered speech.

The renderer accepts optional keyword-only `checkpoint_dir` for compositions whose output package is
temporary. The host supplies a persistent, private, book-scoped directory, serializes native rendering
and owns storage quotas and checkpoint retention alongside the book. Completed sections remain after
chapter assembly because a later chapter or host publication can still fail. Retrying an identical
recipe reconstructs the complete chapter before ordinary atomic publication; checkpoint audio never
becomes an accepted chapter by itself. Cancellation and failure retain completed checkpoints while
removing unpublished audio staging. Existing callers use package-private checkpoints by default.

The detailed artifact rules remain canonical in [PACKAGE_CONTRACT_V2.md](PACKAGE_CONTRACT_V2.md).


The additive `render-plan.v2` timing recipe uses `timing.policy = semantic-boundaries-v1`
and `segments[].boundaryBefore` (`kind`, `seconds`). It chooses one boundary per timeline slot:
1.2 seconds after a chapter heading, 0.55 seconds at a paragraph, or the existing 0.24-second
speaker/passage transition. Layered voices share that slot. Paragraph cuts come from accepted
source ranges before narration coalescing: a blank run counts once; a sentence-complete line with
an indent beyond the block's baseline can mark a paragraph; ordinary wraps and same-paragraph
quote-attribution fragments do not. Confirmed chapter anchors identify headings. Legacy artifacts
can also use a strict opening run of standalone short uppercase or labelled heading candidates for
timing only; this fallback never creates a chapter or changes source text. Layout-ambiguous prose
keeps the shorter timing. Consumers include the recipe and boundaries in generation fingerprints.

Timed native rendering retains every sample above the recipe's 16/32768 edge threshold, plus
10 ms margins, then applies 15 ms sine-squared fade-in and 40 ms fade-out, each capped at half a
short clip. Inserted zero samples complete the requested gap after accounting for retained quiet;
interior quiet and above-threshold tail bursts are preserved. An all-silent clip fails before audio
publication. The same timing viability check runs inside bounded synthesis retries and when
restoring cached speech, so a silent section cannot trap an identical retry. Timed fragments up to
32 characters that exhaust every attempt with silence or no result may retry with the existing
speaker-embedding route, retaining the exact accepted voice WAV and source text. The receipt records
that recovery; accepted Cast state and default generation settings are unchanged.
Internal ellipsis pauses retain 0.25 seconds; a terminal ellipsis and following semantic
boundary use their maximum rather than adding two pauses. Existing receipts stay immutable and
playable; legacy plans without timing retain their previous assembly. No background noise is added.


## Public extension boundary

A separately maintained companion may depend on verified artifacts from an exact immutable GitHub
release. It composes around these public seams:

- typed workflow commands and `WorkflowRunner`;
- `BookWorkspace` and immutable artifact contracts;
- narrow runtime-provider protocols;
- the frontend `WorkflowGateway` and the public workflow UI source;
- typed UI capabilities and render hooks for behavior that differs by composition;
- the `edition` i18next namespace, whose semantic keys let a companion register complete per-locale
  copy overrides without copying the shared UI or replacing ordinary workflow translations.

The companion starts with the public workflow and journey definitions, then explicitly inserts,
removes, groups, or replaces stages and handlers. A replacement that preserves its public output
artifact may keep public downstream consumers; an incompatible artifact requires an adapter or private
replacement of those consumers. Account, billing, tenant, object-storage, and queue identifiers never
belong in public artifact JSON.

The `showVoiceModelControls` and `advancedDialogueRules` UI capabilities default to `true` for
local installations, where users may configure the voice runtime and speaker-matching rules.
A companion that manages those choices sets them to `false`: the workflow retains its current
voice selection, language, auditions, reuse choices, and quote checks, while model names and
advanced rule editors are omitted from the interface. These capabilities do not change provider
selection or permission to run a command.

Edition translations change presentation only. They must not be used to disguise an unavailable
capability: filesystem actions, provider routes, and supplier-cost visibility remain explicit typed
composition choices. Every edition bundle must implement the complete key contract for every supported
locale so a hosted locale can fall back only to its own truthful English copy, never to local-product
claims.

The current release intentionally does not add hosted services. Reusable Python and React modules are
workspace implementation details of the complete local application; when a companion integration is
ready, CI may attach them as verified release assets without requiring public package registries.

## Distribution contents

The source distribution uses an explicit allowlist. It contains Python source, compiled frontend
assets, the model registry, license, README, and build metadata. It excludes dependency directories,
maintainer plans, local model files, sample books, working state, runs, results, and audits.

The wheel installs compiled frontend assets under `meowdiobooks/web` and the model registry under
`meowdiobooks/resources`. Asset lookup prefers checkout files during development and installed package
resources after installation.

## Contract tests

Changes at an architecture boundary must keep these checks green:

- typed command validation and persisted local-job round trips;
- runner dispatch without HTTP or queue state;
- workspace publication, invalidation, and immutable history;
- API workflow and lifecycle regressions;
- frontend gateway serialization and complete UI behavior tests;
- explicit distribution allowlist and installed-wheel smoke test.

When a companion adapter is introduced, it should run the same command/artifact fixtures and frontend
gateway behavior suite as the local adapters before either package is released.

### Automatic cross-book casting

The default Cast UI automatically checks prior books through `cast_voice_reuse.preview`, using
an empty source selection. `voiceReuseAvailable` enables live provenance during Cast editing;
`castingPreviewAvailable` separately enables hosted price quotes. Read-only previews can inspect
unconfirmed identities, but the generation and acceptance review gates remain unchanged.

`match_latest_voices` matches normalized exact literal labels and aliases, using names only for
legacy identities without labels. It selects the newest eligible book by creation time, with book
ID as a stable tie-break. Multiple matching voices in that book remain unmatched rather than being
guessed. It never merges destination characters, uses fuzzy similarity, or calls an AI matcher.

Standalone Core uses `LocalVoiceReuse` over its book store. Compositions supply an adapter over
their authorized store and provider-compatible receipts. Only accepted selected voices with valid
compatible audio are eligible. `latest_approved_cast(package)` reads the newest accepted immutable
Cast, even if a reset removed the active Cast pointer or newer unapproved drafts exist. Draft writes
and failure cleanup retain that approved Cast's audio until a newer Cast is accepted; they do not
restore approval to a draft. Local matches require the same language and model. Imports copy
complete audio references into destination-owned files, so deleting the source cannot break them.

Each match starts with only the inherited audition, marked `source: "previous-book"` and
`previousBookTitle`. Matched identities retain ordinary current-book voice profiling but skip
automatic audio generation. The row saves `voiceProfileSettings` for later manual auditions;
the inherited candidate retains its original acoustic settings for acceptance and rendering. Users can
explicitly request another audition through the ordinary add/regenerate control, then select or
delete choices normally. An explicit choice overrides the first-playable default. The inherited
pack and manually added options remain complete across unchanged retries. Model/recipe changes
recheck source compatibility and generate only where no compatible inherited choice remains.
Required identity review remains blocking and takes visual priority; suggested review stays optional.
The Voices grid derives provenance from the chosen candidate. Bulk acceptance retains its existing
confirmation, and selected references/settings flow through to render planning.

The adapter retains explicit source-ID/import APIs for compatible clients, but the default UI has
no manual source-book or voice picker. Supplied preview fingerprints are revalidated before import.
Provider pricing counts only unmatched targets; explicit new auditions use normal generation pricing.
