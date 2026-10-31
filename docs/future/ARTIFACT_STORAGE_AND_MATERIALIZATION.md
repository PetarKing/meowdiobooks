# Selective artifact storage and materialization

Status: pattern documented; only the chapter-audio consumer seam is implemented in core.

## Current contract

The open-source application remains local-first. Published chapter WAV files are durable package
artifacts on disk, and the default chapter-audio source returns that exact local path. A composition
may instead provide a context-managed source for an exact book, chapter, and render revision. The
consumer receives a readable local path for the duration of its work; the provider owns any fetch,
verification, and cleanup required around that path.

This seam lets hosted deployments keep large published WAV files in private object storage and
materialize them only while building an M4B. It does not add an object-store dependency, background
sync service, or remote-storage configuration to core.

## General pattern

The same boundary can later support other artifact classes without making local workflows depend on
a particular storage vendor:

1. Identify an immutable artifact by logical owner, kind, and revision.
2. Record a receipt containing its remote object key, byte size, and digest.
3. Ask a provider for a context-managed local path only when a consumer needs bytes.
4. Verify the materialized bytes against the receipt before exposing them.
5. Release the context and remove transient files after the consumer finishes, including on failure.

Potential consumers include source documents, voice references, rendered previews, export inputs,
and generated deliverables. Each artifact kind needs an explicit durability policy; temporary
working files should not be confused with published user artifacts.

## Selective sync direction

A future storage policy could let users choose which artifact kinds or projects remain local, sync
to an external provider, or become remote-only after verification. A safe design would require:

- opt-in policy at a clear scope, with local-first defaults;
- upload receipts and digest verification before any local eviction;
- retryable, idempotent transfers with observable pending/failed states;
- pinning or leases so cleanup cannot remove bytes used by active work;
- bounded caches and startup reconciliation for interrupted operations;
- export/import tooling so provider choice never becomes data lock-in.

Automatic cleanup must be the consequence of a verified durability policy, not merely elapsed time.
The metadata plane should retain enough information to distinguish intentionally remote artifacts
from lost files and to reconstruct the local package view when requested.
