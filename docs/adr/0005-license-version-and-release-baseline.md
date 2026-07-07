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

- package version `0.1.1`;
- package names under the verified `@0disoft` npm scope;
- license `MIT`;
- repository, bugs, homepage, description, and keywords metadata;
- `publishConfig.access = "public"`;
- built `dist` artifacts as the package `files` surface.

The first npm release baseline is manual and validation-gated. Publishing to npm is
allowed under `@0disoft` after authentication is confirmed. The earlier `v0.1.0`
GitHub release is a pre-publication inspection baseline and is superseded for npm
publication by `v0.1.1`.

## Rationale

MIT matches the intended small OSS utility surface and keeps downstream adoption
simple. Version `0.1.1` communicates an implemented MVP baseline without promising
stable `1.0` compatibility, while avoiding mutation of the existing `v0.1.0`
GitHub release after the npm scope correction.

## Consequences

- Package consumers can inspect license and package metadata before publication.
- Semver-governed surfaces exist, but pre-`1.0` compatibility can still evolve.
- Release automation is now decided in ADR 0007; manual release steps must keep
  validation evidence explicit when used as a break-glass fallback.
- A future ADR must change license, npm scope, or automated publish strategy.

## Review Blockers

- A package is published without passing the documented release gates.
- A package is published under an unverified npm scope.
- License metadata drifts from `LICENSE`.
- Release automation is added without documenting credentials, rollback, and
  failure handling.
