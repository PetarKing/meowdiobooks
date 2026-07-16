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

Voice-sample transcription is a narrow best-effort boundary: the browser uploads one temporary sample,
the selected local adapter returns editable text plus an optional detected language, and neither result
is published as an artifact. The current adapter is MLX-Audio on Apple Silicon. A Linux adapter may
implement the same function and HTTP/gateway response without changing Cast UI or accepted voice data.

## Authority and publication

The backend is authoritative for accepted state. The browser may prepare settings and decisions, but
it cannot publish artifacts or infer that a stage is accepted.

- Candidates and accepted artifacts are immutable revision files.
- A candidate may be accepted only against its exact accepted parent revisions.
- `artifacts/latest.json` is the one active stage-pointer map.
- Publishing a revision atomically replaces its pointer and removes downstream active pointers.
- Invalidation never deletes history or the last successfully generated audio.
- A failed or canceled job publishes nothing.

The detailed artifact rules remain canonical in [PACKAGE_CONTRACT_V2.md](PACKAGE_CONTRACT_V2.md).

## Public extension boundary

A separately maintained companion must depend on an exact tagged public release. It may compose
around these public seams:

- typed workflow commands and `WorkflowRunner`;
- `BookWorkspace` and immutable artifact contracts;
- narrow runtime-provider protocols;
- the frontend `WorkflowGateway` and the public workflow UI source.

It must not copy or patch public workflow files, replace backend acceptance authority, or introduce
account, billing, storage, or queue identifiers into public artifact JSON. Generally useful extension
points are added here first, contract-tested, released, and then consumed by the companion.

The current release intentionally does not add hosted services or split the repository into separate
core and UI packages. That packaging move should happen only when the first companion integration
requires independently versioned Python and JavaScript artifacts. Until then, the Python wheel is the
installable local release and the public Git tag is the matching source/UI release.

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
