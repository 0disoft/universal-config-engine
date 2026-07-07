# ADR 0005: License, Version, and Release Baseline

Status: Accepted
Owner: UNASSIGNED

## Purpose

Record the first OSS release-readiness baseline for package metadata, licensing,
versioning, and release gates.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Library semver: `docs/library/semver.md`
- Release operations: `docs/ops/release.md`
- Rollback operations: `docs/ops/rollback.md`

## Decision

The repository uses the MIT license. The root workspace remains private, but each
workspace package is prepared as a public package with:

- package version `0.1.0`;
- license `MIT`;
- repository, bugs, homepage, description, and keywords metadata;
- `publishConfig.access = "public"`;
- built `dist` artifacts as the package `files` surface.

The first release baseline is manual and validation-gated. Publishing to npm is
allowed only after package scope ownership and npm authentication are confirmed.
Until then, release validation stops at local checks, packed artifact smoke tests,
and GitHub tag or release preparation.

## Rationale

MIT matches the intended small OSS utility surface and keeps downstream adoption
simple. Version `0.1.0` communicates an implemented MVP baseline without promising
stable `1.0` compatibility. Keeping npm publication gated avoids claiming package
availability before the scope and credentials are verified.

## Consequences

- Package consumers can inspect license and package metadata before publication.
- Semver-governed surfaces exist, but pre-`1.0` compatibility can still evolve.
- Release automation remains a future decision; manual release steps must keep
  validation evidence explicit.
- A future ADR must change license, npm scope, or automated publish strategy.

## Review Blockers

- A package is published without passing the documented release gates.
- A package is published under an unverified npm scope.
- License metadata drifts from `LICENSE`.
- Release automation is added without documenting credentials, rollback, and
  failure handling.
