# Contributing

Meowdiobooks is alpha software. Contributions should make the local book-to-audio path more
trustworthy without hiding uncertainty or weakening source traceability.

## Contributor agreement

Every external contributor must accept the [Contributor License Agreement](../CLA.md) before a pull
request can be merged. The agreement lets Petar Nedeljkovic use accepted Contributions in public,
private, hosted, proprietary, commercial, and non-commercial versions of Meowdiobooks without
payment, royalties, or revenue share. Contributors retain ownership of their work.

Accept the agreement by checking its box in the pull-request template while signed into the GitHub
account submitting the Contribution. Maintainers must not merge a pull request without recorded
acceptance. If an employer or another entity owns the work, the contributor must provide evidence
of authorization or arrange a separate corporate agreement before merge.

Before a substantial change, open an issue that states:

- the user problem and expected value;
- the proposed scope and affected contracts;
- edge cases and failure behavior;
- the test and real-book verification strategy;
- new dependencies or architecture impact.

New services, databases or tables, caches, cross-service dependencies, network inference, and new
runtime dependencies require maintainer approval before implementation.

## AI-assisted contributions

AI coding agents made the early version of Meowdiobooks possible to deliver at its current pace. The
project welcomes AI-assisted contributions, but AI is a capacity multiplier, not a reason to submit
less considered work. When a tool makes implementation, exploration, or testing cheaper, use that
capacity to produce broader evidence and stronger confidence than an unaided change would normally
receive.

The pull-request author remains accountable for the entire contribution, regardless of how it was
produced:

- Contributors do not need to disclose whether or which AI tools they used. Review is based on the
  submitted work and its evidence, not the contributor's choice of tools.
- Read and understand every submitted change, including tests, generated files, dependency updates,
  migrations, and documentation. The author must be able to explain the design and its failure
  modes.
- AI assistance does not relax the Contributor License Agreement. The author confirms that every
  submitted contribution can be licensed under that agreement and discloses any third-party source,
  license, patent, trademark, or copyright restriction.
- Report uncertainty, failed checks, untested paths, and tool limitations honestly. Never claim that
  a command, scenario, browser flow, or output comparison was checked when it was not.

Automated tests are the baseline, not sufficient proof of product behavior. Every pull request must
include a reproducible verification record appropriate to its risk:

- Record the commands, environments, scenarios, and results. Attach or link evidence that a reviewer
  can inspect; an agent's statement that something works is not evidence by itself.
- For user-visible or end-to-end workflow changes, include before-and-after screenshots and a short
  screen recording of the affected flow. If visual evidence is genuinely inapplicable, say why and
  provide the corresponding logs, output comparisons, benchmarks, or other inspectable artifacts.
- If the available agent can operate a browser or inspect images, have it exercise the complete
  affected flow in addition to running automated tests, including relevant error, retry, and
  recovery paths. Otherwise, the contributor must perform the equivalent manual check.
- For extraction, review, attribution, casting, generation, or export changes, run the relevant
  [public-domain evaluation samples](../SampleBooks/public-domain-evaluation/README.md). Expand the
  matrix with appropriately licensed or synthetic sources when language, layout, dialogue density,
  book length, model route, or runtime differences could expose a regression. Record
  before-and-after results rather than reporting only that the process completed.
- For mission-critical product contracts, one implementation agent reviewing its own work is not
  sufficient. When the tooling supports delegation, assign multiple fresh-context sub-agents
  distinct verification work: read the relevant source and generated outputs, inspect different edge
  cases, compare before-and-after behavior, and challenge one another's findings. Reconcile
  disagreements and inspect the underlying evidence before submission. When sub-agents are
  unavailable, perform equivalent independent manual review. Scale the breadth to the risk; agent
  count alone is not proof.

Do not submit unreviewed generated code, tests that merely repeat the implementation,
happy-path-only evidence for regression-sensitive behavior, or large generated reports that obscure
the actual findings. Repository issues, commits, and pull-request evidence must not contain
credentials, private user data, or unredistributable material. Maintainers may require additional
evidence or a narrower change before merge.

## Quality checks

Set up the development environment using the [setup reference](SETUP.md), the source of truth for
platform- and runtime-specific dependencies.

```bash
uv run pytest -q
uv run ruff check src/meowdiobooks tests
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
```

GitHub pull-request checks run the cross-platform backend suite with tests marked
`uses_audio_decoder` or `runs_models` excluded. Before release, run the complete backend suite in
each supported runtime environment affected by the change.

Do not commit books, generated user artifacts, model weights, or other material you do not have the
right to redistribute. Tests should use synthetic or appropriately licensed fixtures.
