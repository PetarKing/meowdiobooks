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
