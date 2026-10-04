# Architecture and release boundary

Status: current public-alpha architecture.

Meowdiobooks is a complete local application. Installing the public Python distribution provides the
API, local workflow runtime, compiled browser application, model registry, and command-line entrypoint.
No account, hosted service, private repository, database, or network provider is required to run it.

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
marker. Reloads hydrate authoritative snapshots and pending candidates before reattaching a job, and
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
uses this wash, while its visible status always describes audio readiness: Generated, Older recording
or To make. Purchase never changes that status, and no redundant Purchased badge is shown. Omission, a different book,
or a changed accepted parent removes the presentation. Existing audio never implies purchase.
This prop grants no permission and does not change generation commands or host funding checks;
account and payment records remain outside the workflow model and artifacts.

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

### Untrusted PDF parsing

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

### Book-list fault isolation

Book discovery validates each record and workspace independently. A malformed book is omitted from
the list without reinterpreting retired stages, changing its data, or hiding healthy books. Mutations
of healthy records preserve unrelated raw records, including malformed ones. Non-book failures and
store-wide failures remain explicit errors; isolation does not turn an inaccessible store into an
empty shelf.

## Authority and publication

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

The detailed artifact rules remain canonical in [PACKAGE_CONTRACT_V2.md](PACKAGE_CONTRACT_V2.md).

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

### Optional cross-book casting

Compositions can supply `cast_voice_reuse` to expose the shared compact Cast chooser. Its `preview`
method is read-only and returns eligible source books, exact-match counts, casting choices and
currency-aware estimates. `apply` runs inside Cast generation only after the user continues; the
composition may use AI for identities not matched exactly. Source book IDs form a canonical set. Exact matches must be unique
across the selected pool; conflicting source candidates are never resolved by selection order. The preview fingerprint binds the reviewed selection to application.
An optional `import_voice` method supports explicit source-voice correction during audition review.

The composition must authorize sources, validate compatibility and copy complete immutable voice
assets into the destination before returning. Core preserves destination character identity and
requires normal audition acceptance. Reopening the same selection uses destination snapshots without
reading the source. The source book is provenance, never an ongoing dependency. AI uncertainty should
leave a character for ordinary generation rather than introduce a required manual matching phase.
