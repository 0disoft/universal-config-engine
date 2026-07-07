# Release

Status: Draft

## Operational Contract

Release preparation is manual and validation-gated for the `0.1.x` baseline.
Publishing to npm is blocked until package scope ownership and npm authentication
are confirmed.
GitHub release assets may be attached before npm publication when they are produced
from the validated tag and contain no credentials or generated diagnostic reports
with raw secret values.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive release failures; do not
  include npm tokens or credentials in issues.

## Release Types

- Patch: fixes that preserve documented behavior.
- Minor: additive public API, CLI report, package, or adapter behavior.
- Major: reserved for post-`1.0` breaking changes.

## Pre-Release Checklist

Run these checks from the repository root:

```powershell
pnpm run check
pnpm run smoke:core-package
pnpm run smoke:packages
git diff --check
ssealed doctor
```

Before publishing, also verify:

- package versions are aligned across publishable workspace packages;
- package metadata license is `MIT`;
- `LICENSE` exists and matches package metadata;
- npm scope ownership and authentication are confirmed;
- no secret-like values appear in tracked files or generated reports.

## Publish Flow

1. Confirm the version in each publishable package.
2. Run the pre-release checklist.
3. Create a signed or annotated git tag for the package baseline.
4. Create or update the GitHub release for the tag.
5. Attach packed package tarballs to the GitHub release after rebuilding from the
   tagged commit.
6. Publish packages only after npm scope ownership and authentication are confirmed.
7. Verify installed package imports and the `uce` binary from published artifacts.

## GitHub Release Asset Flow

GitHub release assets are inspection artifacts, not a substitute for npm package
publication. Generate them only from a clean checkout at the release tag:

```powershell
pnpm -r build
New-Item -ItemType Directory -Force -Path .tmp/release | Out-Null
pnpm --filter @universal-config-engine/core pack --pack-destination .tmp/release
pnpm --filter @universal-config-engine/node pack --pack-destination .tmp/release
pnpm --filter @universal-config-engine/cli pack --pack-destination .tmp/release
pnpm --filter @universal-config-engine/validator-ajv pack --pack-destination .tmp/release
pnpm --filter @universal-config-engine/validator-zod pack --pack-destination .tmp/release
gh release upload <tag> .tmp/release/*.tgz --repo 0disoft/universal-config-engine --clobber
gh release view <tag> --repo 0disoft/universal-config-engine --json assets,tagName,url
pnpm run clean:build
```

The `v0.1.0` release includes tarballs for core, node, CLI, Ajv validator, and Zod
validator packages. Npm publication remains blocked until scope ownership and
authentication are confirmed.

## Stop Conditions

- Any required validation fails.
- `git status --short` is not clean before tagging.
- npm scope ownership or authentication is not confirmed.
- Package metadata does not match ADR 0005.
- A report, fixture, or package artifact exposes raw secret values.
- GitHub release assets cannot be reproduced from the validated tag.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: failing local validation, failed smoke package checks,
  unconfirmed npm scope/authentication, or secret exposure.
- Remaining operational risk: hosted CI currently covers one Ubuntu runner; npm
  publish automation and cross-platform release verification remain future work.
