# Publishing workflow releases

Use this runbook for shared workflow asset publication. Ordinary local changes do not require a
release. Preserve unrelated work throughout; see [contributor guidance](CONTRIBUTING.md#git-and-working-state).

## Resolve the candidate

Fetch current remote state and resolve one reviewed, exact 40-character candidate commit SHA already merged
into `origin/main`. Inspect relevant open pull requests and worktrees for in-scope release blockers.
Build from a clean checkout of that candidate, using an isolated worktree when the primary checkout
is in use. Record the candidate SHA before building.

A later `main` commit does not invalidate that candidate unless it is required by the task or fixes an
in-scope release blocker. For a “latest” request, use the snapshot at candidate selection and disclose
later commits; honor an explicit latest-at-completion requirement if one was requested. If the
candidate changes, rebuild and verify its assets. Never change an already-published release.

Version changes must themselves be merged before selecting the final candidate. Keep the Python and
UI versions aligned in `release/python/pyproject.toml`, `frontend/package.json`, and both version
fields in `frontend/package-lock.json`.

## Build and verify

Run backend and frontend verification appropriate to the release, including tests, Ruff, ESLint,
and the production frontend build. Follow [contributor quality checks](CONTRIBUTING.md#quality-checks)
for affected runtime coverage. Build assets with `scripts/build_shared_release.sh`, then verify
`dist/release/SHA256SUMS`. Confirm the directory contains exactly the wheel, UI tarball, checksum
manifest, and tracked `.gitignore` described in [release assets](../release/README.md).

Remove only explicitly identified stale generated assets by resolved path. Never use an unresolved
glob as a cleanup target or delete unrelated artifacts to make a check pass.

## Publish immutable assets

Preserve GitHub's **Verified** provenance badge. Prefer a lightweight release tag pointing directly
at the selected GitHub-verified merge commit, after checking its GitHub verification status. If an
annotated tag is required, sign it with a configured GPG or SSH key; never publish an unsigned
annotated release tag. A signing badge does not verify asset contents.

Enable repository release immutability before publication. Push the verified tag, create a draft
release with the wheel, UI tarball, and `SHA256SUMS` named explicitly, and inspect its tag target and
exact asset list before publishing. Verify through the GitHub API that the published release is
non-draft and `immutable: true`. Resolve its peeled tag to the candidate SHA and compare downloaded
published asset hashes with the verified checksum manifest.

An immutable release, its tag, and its assets are final. Never delete, replace, or amend them. Fixes
require a new patch version built and verified from a new merged candidate.

## Handoff and cleanup

Report the exact tag, peeled commit SHA, asset filenames and SHA-256 values, release immutability,
and verification results so consumers can pin them independently. Identify untested paths and any
relevant open pull requests or task-created worktree/branch intentionally left behind. Do not claim
consumer adoption or deployment merely because publication succeeded.

Clean up only task-created resources whose work is proven preserved. Keep the user's primary
checkout and unrelated work intact; no repository-wide cleanup is required to finish a release.
