# ADR 0007: Trusted Publisher Release Automation

Status: Accepted
Owner: 0disoft

## Purpose

Record the first automated npm publication path after the `@0disoft` packages were
published manually and Trusted Publisher records were registered in npm.

## Source of Truth

- Release operations: `docs/ops/release.md`
- Rollback operations: `docs/ops/rollback.md`
- Package baseline: `docs/adr/0005-license-version-and-release-baseline.md`
- Workflow file: `.github/workflows/release.yml`

## Decision

The repository publishes npm packages through GitHub Actions Trusted Publisher
using `.github/workflows/release.yml`.

The Trusted Publisher registration for every package must use:

- publisher: GitHub Actions;
- organization or user: `0disoft`;
- repository: `universal-config-engine`;
- workflow filename: `release.yml`;
- environment: empty unless a future ADR introduces a protected release
  environment;
- allowed action: npm publish.

The release workflow is tag-driven for exact stable or semantic-version
prerelease tags such as `v<major>.<minor>.<patch>` and `v1.0.0-rc.1`. It:

- installs dependencies with the locked pnpm version;
- checks that publishable package versions match the tag version;
- runs the release validation gates;
- builds and packs each publishable workspace package;
- uploads GitHub release tarballs from the validated tag;
- records package-level npm publication state before and after publication;
- publishes the packed tarballs with npm CLI provenance enabled.

Stable versions publish under the npm `latest` dist-tag. Prerelease versions
publish under `next` and create or update a GitHub prerelease. Post-publication
verification fails if the expected dist-tag does not point to the released version
or if a prerelease replaces npm `latest`.

Publication state uses schema `0.1` and records the release version, tag, commit,
workflow run and attempt, observation phase, and `published` or `missing` status for
each of the five packages. A registry lookup failure is not treated as a missing
package. Each workflow attempt preserves its before and after manifests as GitHub
Release assets. A rerun skips only packages confirmed as already published by its
before manifest and resumes the remaining packages in dependency order.

`pnpm pack` remains responsible for producing publishable tarballs from workspace
packages. `npm publish <tarball>` is the final publication command so npm Trusted
Publisher and provenance behavior are owned by npm CLI.

## Rationale

Trusted Publisher removes long-lived npm tokens from the release path. Publishing
packed tarballs avoids relying on npm to understand `workspace:*` dependencies
while still letting npm CLI perform the OIDC-backed publish operation.

Tag-driven release limits accidental publication from arbitrary branches. Manual
dispatch is dry-run by default and is intended for validation, not routine release.
Manual dry-runs check out the workflow-dispatch commit while deriving the expected
package version from the required tag-shaped input, so a release candidate can be
validated before its tag exists. A manual non-dry-run still checks out the named
tag and cannot publish arbitrary branch contents.

## Consequences

- GitHub Actions now needs `id-token: write` for npm publication.
- GitHub Actions needs `contents: write` to create or update release assets.
- A bad publish should be handled by deprecating the bad version and releasing a
  fixed patch, not by rewriting public history.
- Package version bumps must happen before tagging.
- Future changes to publisher, environment, package scope, or release trigger must
  update this ADR and `docs/ops/release.md`.
- npm publication is not atomic, but each attempt now leaves durable package-level
  evidence and can resume without trying to overwrite published versions.

## Review Blockers

- The workflow publishes from a branch instead of a validated semver tag.
- A non-dry-run publication checks out the workflow-dispatch branch instead of the
  named release tag.
- The workflow publishes unpacked package directories instead of packed tarballs.
- A long-lived npm token is reintroduced for routine release.
- The npm Trusted Publisher repository or workflow filename differs from this ADR.
- A non-dry-run publication does not preserve package-level before and after state.
