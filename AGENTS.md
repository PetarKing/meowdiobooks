# Repository agent rules

Meowdiobooks is the reusable local workflow application. Read the relevant sections of
[architecture](docs/ARCHITECTURE.md) before changing shared behavior or composition contracts.
Keep companion-specific credentials, operations, and product policy out of this repository.

## Working scope and Git

- Use the contributor's own authorized GitHub account for authenticated operations and honor any
  explicit session identity constraint. Verify the identity before the first authenticated operation;
  reuse that verification until credentials or host context changes. If verification fails, stop
  authenticated GitHub operations and continue safe local work.
- Follow [contributor guidance](docs/CONTRIBUTING.md) for scope, working-state preservation, and
  risk-appropriate evidence. Existing maintainer/session approval covers its stated scope.
- Before treating unavailable hosted CI as a merge blocker, consult any owner-authorized outage
  record supplied by the active workspace/session. During an explicitly recorded exception, run
  the required local equivalents, retain exact-commit command/results evidence on the PR, and
  complete review. Existing authorization covers that process; do not request it again or re-enable
  manually disabled workflows without following the record's restoration procedure. This changes
  where checks run, not which checks are required or whether release/deployment is authorized.
- Synchronize only the branch needed for the authorized task. Never push unrelated ahead-of-main
  commits or switch the user's primary checkout merely to satisfy cleanup.
- Remove task-created branches/worktrees only after proving their work is preserved; report
  unrelated or unique state instead of discarding it.

## Workflow releases

Read [the release runbook](docs/WORKFLOW-RELEASE.md) when publishing shared workflow assets. Select
one exact reviewed merged candidate; later main commits do not automatically restart publication.
Preserve version alignment, provenance, published asset hashes, and release immutability. A published
release is final; fixes require a new version. Report publication separately from consumer adoption.
