# Public repository publication

The repository uses [PolyForm Noncommercial 1.0.0](../LICENSE) and the existing [contributor
agreement](../CLA.md). Public visibility does not change those terms. Describe the project as
source-available: the commercial-use restriction does not meet the
[Open Source Definition](https://opensource.org/osd). A change of license requires a separate
maintainer decision and review of contribution and asset rights.

## Source and evidence

Maintain setup, workflow, architecture and design contracts with the implementation. Keep personal
paths, hosted-companion operations, account identifiers, private books, model weights, credentials
and generated user data out of tracked files. Use synthetic or attributed redistributable fixtures.
Retain [asset provenance](ASSET_PROVENANCE.md) when replacing or removing design review material.

Generated review captures belong in the ignored `.review-evidence/` directory or a temporary
directory. A pull request can attach selected sanitized evidence; a full experiment capture matrix
does not belong in the maintained source documentation.

Run `python3 scripts/check_publication.py` for tracked-file privacy hygiene, local documentation
links and synchronized license copies. This check does not detect credentials, certify asset
rights, inspect media pixels or erase history. Before changing repository visibility, scan the
selected source and all Git refs with a secret scanner such as Gitleaks, review metadata and
discussions, and inspect the published archives. Never include secret values in audit output.

Removing a file from the current branch leaves it in historical commits, tags and GitHub-generated
source archives. Existing author email addresses and internal review records remain public if the
existing repository becomes public. Decide explicitly whether to retain that history or publish a
fresh reviewed snapshot in a separate public repository; keep the private repository and consumer
pins intact during any migration. Neither history rewriting nor a visibility change is a routine
documentation cleanup.

## Release navigation and retention

[Workflow releases](https://github.com/PetarKing/meowdiobooks/releases) contain integration assets.
Use the [latest release entry](https://github.com/PetarKing/meowdiobooks/releases/latest) for
discovery, then pin an exact verified tag, commit, filenames and checksums. These packages are not
an application installer or a model bundle; see [release assets](../release/README.md).

V1 establishes a new public baseline under the owner's one-time reset authorization, with pre-V1
records preserved privately and consumers migrated before old releases are retired.
After that transition, published immutable releases, tags and asset hashes remain unchanged. Consolidate release
navigation and future release cadence rather than deleting or replacing historical assets.
Do not remove a legacy mutable release without first checking consumer pins and receiving explicit
authorization. A cleanup of source files cannot sanitize old release payloads or source archives.

Each new wheel and UI tarball must include the canonical license terms and required copyright
notice. The builder checks the package-local license copies against the root license. Packaging
fixes require a new version and the normal [release procedure](WORKFLOW-RELEASE.md); a local build
of a published version is validation only and must never replace its published assets.

## Before changing visibility

Confirm the license choice, rights to retained artwork and fixtures, exposure of historical content
and author metadata, and the availability of a private vulnerability-reporting channel. Inspect
repository description, issue and pull-request discussions, release notes, archives and any
attachments. Obtain maintainer authorization for the concrete public transition after this review.
