# Workflow launch-readiness regressions

2026-10-04. These changes belong to the shared workflow: language confirmation, generation completion
presentation, and an optional generic import identity seam. Account naming and storage admission
remain the host's responsibility; there are no hosted credentials or policies in this repository.

- Confirming the already-selected narration language after its quote settles preserves readiness.
  A changed language still invalidates the quote, and failed or pending quotes do not enable work.
  Mounted application tests cover all four cases, including the submitted language/fingerprint.
- Zero remaining chapters shows “None remaining”; one ready chapter uses singular copy. Both English
  and Simplified Chinese resources are included. The completion fixture remains ready for export.
- `create_app_v2(book_id_for_source=...)` optionally resolves the verified full source SHA-256 to a
  stable, path-safe ID in the host's store. Local IDs stay content-derived. Unsafe IDs are rejected
  before writing, and an existing ID with a different source hash returns HTTP 409.

Validation: 513 backend tests passed (three audio/model tests deselected); Ruff passed. The targeted
casting/generation/quote tests and existing mounted App suite passed. The two added Storybook
stories passed Chromium interaction/accessibility checks. Parent browser inspection confirmed
the settled English quote with Continue enabled and the completed single-chapter state with
Continue to Export enabled. These are local regression results; hosted adoption and deployment
require a separate immutable release and host compatibility verification.
