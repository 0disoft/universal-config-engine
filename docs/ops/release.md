# Release

Status: Draft

## Operational Contract

Release preparation is validation-gated for every `0.x` release. Routine npm
publication uses GitHub Actions Trusted Publisher through
`.github/workflows/release.yml`. GitHub release assets may be attached before or
alongside npm publication when they are produced from the validated tag and contain
no credentials or generated diagnostic reports with raw secret values.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive release failures; do not
  include npm tokens or credentials in issues.

## Release Types

- Patch: fixes that preserve documented behavior.
- Minor: additive public API, CLI report, package, or adapter behavior.
- Major: reserved for post-`1.0` breaking changes.
- Release candidate: a version such as `1.0.0-rc.2`, published to npm under
  `next` and marked as a GitHub prerelease without replacing npm `latest`.

## Pre-Release Checklist

Run these checks from the repository root:

```powershell
pnpm run check
pnpm run smoke:core-package
pnpm run smoke:packages
actionlint
pnpm audit --audit-level=high
git diff --check
ssealed doctor
```

Before publishing, also verify:

- package versions are aligned across publishable workspace packages;
- package metadata license is `MIT`;
- `LICENSE` exists and matches package metadata;
- `pnpm run smoke:packages` installs the packed tarballs into a temporary consumer
  project, compiles and runs the legacy validator compatibility fixture, and
  verifies package imports plus the `uce` binary;
- the release workflow installs all five exact published versions from the public
  npm registry into a blank temporary project and verifies ESM imports plus the
  `uce` binary before declaring publication successful;
- npm Trusted Publisher is registered for every publishable package;
- no secret-like values appear in tracked files or generated reports.
- all remote GitHub Actions references are immutable commit SHAs and the latest
  CodeQL run for the candidate commit completed without an untriaged blocker.

Before creating a release tag, dispatch `release.yml` from `main` with the intended
tag text and `dry_run: true`. The workflow checks out that `main` commit, verifies
its package versions against the tag text, builds the release tarballs, and runs npm
publish in dry-run mode. Non-dry-run execution continues to require the named tag.
The same commit must contain a non-empty `docs/releases/<tag>.md`; the workflow uses
that reviewed file as the GitHub Release body and rejects generic generated notes.

## Publish Flow

1. Confirm the version in each publishable package.
2. Run the pre-release checklist.
3. Create a signed or annotated git tag for the package baseline.
4. Push the tag to GitHub.
5. Let `.github/workflows/release.yml` rebuild from the tag, attach GitHub release
   tarballs, and publish npm packages through Trusted Publisher.
6. Verify installed package imports and the `uce` binary from published artifacts.

Every non-dry-run attempt attaches `publication-state-...-before.json` and
`publication-state-...-after.json` to the GitHub Release. The workflow distinguishes
an npm `404` from registry lookup failure and resumes only packages recorded as
missing. Preserve these manifests when investigating a partial release.

The post-publication smoke can also be reproduced with
`$env:RELEASE_VERSION = "1.0.0-rc.2"; pnpm run smoke:registry-packages`.

Stable tags publish with the npm `latest` dist-tag. Semantic-version prerelease
tags publish with `next`; the workflow verifies both that `next` points to the
released version and that a prerelease did not replace `latest`. Consumers must use
an exact prerelease version or the explicit `next` tag to opt in.

Manual local publication is a break-glass fallback only. If it is used, it must
follow the same validation gates and use a temporary `.npmrc` that is removed
after publication.

## Trusted Publisher Registration

Every npm package in this repository must use the same Trusted Publisher settings:

- publisher: GitHub Actions;
- organization or user: `0disoft`;
- repository: `universal-config-engine`;
- workflow filename: `release.yml`;
- environment name: empty unless ADR 0007 is updated;
- allowed action: npm publish.

## GitHub Release Asset Flow

GitHub release assets are inspection artifacts, not a substitute for npm package
publication. The release workflow generates them from the tag with:

```powershell
pnpm -r build
New-Item -ItemType Directory -Force -Path .tmp/release | Out-Null
pnpm --filter @0disoft/universal-config-engine-core pack --pack-destination .tmp/release
pnpm --filter @0disoft/universal-config-engine-node pack --pack-destination .tmp/release
pnpm --filter @0disoft/universal-config-engine-cli pack --pack-destination .tmp/release
pnpm --filter @0disoft/universal-config-engine-validator-ajv pack --pack-destination .tmp/release
pnpm --filter @0disoft/universal-config-engine-validator-zod pack --pack-destination .tmp/release
gh release upload <tag> .tmp/release/*.tgz --repo 0disoft/universal-config-engine --clobber
gh release view <tag> --repo 0disoft/universal-config-engine --json assets,tagName,url
pnpm run clean:build
```

The `v0.1.0` release includes pre-publication tarballs for core, node, CLI, Ajv
validator, and Zod validator packages under the superseded package scope. The
`v0.1.1` release is the first npm publication baseline under `@0disoft`. Later
releases, including the `0.2.x` through `0.6.x` lines, are published by
`.github/workflows/release.yml`. The `1.0.0-rc.1` line is the first prerelease
published under npm `next`.

Stable `1.0.0` must follow the review-period and candidate-revalidation contract in
`docs/library/stability-1.0.md`; a successful candidate publication alone does not
authorize immediate stable publication.

`release-policy.json` is the machine-readable stable release authorization list.
Every stable version must declare its reviewed candidate, previous stable version,
and minimum review hours. The release workflow fails closed for unlisted stable
versions and verifies the candidate release assets, complete publication evidence,
npm integrity, provenance, dist-tags, and registry installation before continuing.

The stable `1.0.0` preparation and publication sequence is tracked in
`docs/ops/stable-1.0-release-checklist.md`. Its allowed-diff rule prevents stable
package contents from drifting beyond the reviewed RC2 candidate.

## Stop Conditions

- Any required validation fails.
- `git status --short` is not clean before tagging.
- npm Trusted Publisher registration is missing or mismatched.
- Package metadata does not match ADR 0005.
- A report, fixture, or package artifact exposes raw secret values.
- GitHub release assets cannot be reproduced from the validated tag.
- Publication state cannot be read reliably from npm or preserved on the GitHub
  Release.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: failing local validation, failed smoke package checks,
  mismatched Trusted Publisher registration, or secret exposure.
- Remaining operational risk: hosted CI verifies package behavior and packed
  installation on Ubuntu and Windows, but the Trusted Publisher release job itself
  runs only on Ubuntu.
