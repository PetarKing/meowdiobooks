# Repository agent rules

## Git hygiene

- Use only the `PetarKing` GitHub account for this repository. If the active credential cannot be
  verified, stop before any push or remote mutation.
- Before branch, merge, release, or cleanup work, run `git fetch origin --prune`, inspect every
  worktree with `git worktree list`, and compare local `main` with `origin/main`.
- Preserve unrelated local changes. Never discard or overwrite them unless the user explicitly
  authorizes cleanup and the changes are proven to be merged, patch-equivalent, or otherwise safely
  preserved.
- Keep `main` synchronized with `origin/main`: fast-forward when behind, push when ahead, and stop for
  review if the histories diverge. Do not leave completed integration work only on a local branch.
- After a branch is merged, return the primary checkout to clean `main`. Remove temporary worktrees,
  prune deleted remote refs, and delete local branches whose commits are contained in `main`.
- A branch that is not an ancestor of `main` may still be patch-equivalent after a squash, rebase, or
  cherry-pick. Confirm with `git cherry` before deleting it.
- Do not delete a worktree or branch with unique commits or uncommitted files. Commit and merge the
  intended work, preserve it with an explicitly named handoff, or ask the user.
- Before pushing `main`, run the test, lint, and build checks appropriate to the changed scope. Finish
  by reporting `git status -sb`, open pull requests, and any remaining unmerged local or remote branch.

## Publishing workflow releases

- Release only from a clean commit already merged into `origin/main`. Before versioning or tagging,
  fetch with pruning, confirm the local and remote `main` SHAs match, inspect open pull requests and
  worktrees, and reconcile any concurrent committed work. If `main` advances during the release, stop
  and rebuild from the new commit; if an immutable release was already published, increment the
  version and publish a new release instead of changing it.
- Keep the Python and UI versions aligned in `release/python/pyproject.toml`,
  `frontend/package.json`, and both version fields in `frontend/package-lock.json`.
- Run the complete backend and frontend verification appropriate to the release, including tests,
  Ruff, ESLint, and the production frontend build. Build assets with
  `scripts/build_shared_release.sh`, then verify `dist/release/SHA256SUMS` and confirm the directory
  contains exactly the wheel, UI tarball, checksum manifest, and its tracked `.gitignore`. Remove only
  explicitly identified stale generated assets; never use an unresolved glob as a cleanup target.
- Preserve GitHub's **Verified** provenance badge. Prefer a lightweight release tag that points
  directly at a GitHub-verified merge commit, after checking the commit's GitHub verification status.
  If an annotated tag is required, sign it with a configured GPG or SSH key. Never publish an unsigned
  annotated release tag.
- Repository release immutability must be enabled before publication. Push the verified tag, create a
  draft release with the wheel, UI tarball, and `SHA256SUMS` named explicitly, inspect its tag target
  and exact asset list, then publish it. Verify through the GitHub API that the published release is
  non-draft and `immutable: true`.
- An immutable release, its tag, and its assets are final. Never delete, replace, or amend them. Fixes
  require a new patch version. Hand the exact tag, peeled commit SHA, asset filenames, and SHA-256
  values to the Cloud repository for pinning.
