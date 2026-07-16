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
