# CI

Status: Draft

## Operational Contract

Cover required checks, branch protection, pipeline stages, artifacts, failure policy, local parity, and stop conditions.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive failures; SECURITY.md for sensitive failures

## Local Check Contract

The current local CI equivalent is:

```powershell
pnpm run check
pnpm run smoke:core-package
pnpm run smoke:packages
```

`pnpm run check` runs:

- workspace TypeScript typecheck
- workspace tests
- secret snapshot guard
- adapter compatibility fixture guard
- packed declaration API snapshot guard
- build output cleanup

The smoke commands verify package buildability and package contents for the core, node, CLI, and
validator packages.

Package-level `typecheck` and `test` scripts rebuild their workspace dependency graph before
running package-local checks, so a package test is expected to pass from a clean build-output
state after `pnpm run clean:build`.

## Hosted Workflow

GitHub Actions runs `.github/workflows/ci.yml` on `main` pushes and pull requests.
The existing `check` job remains the Ubuntu compatibility gate and:

- checks out the repository
- installs Node.js 24.11.1
- enables pnpm 11.7.0 through Corepack
- installs the locked dependency graph
- runs `pnpm run check`
- runs `pnpm run smoke:core-package`
- runs `pnpm run smoke:packages`
- runs `git diff --check`

The release workflow additionally runs `pnpm run smoke:registry-packages` after a
real publish. It installs the exact release version from npm rather than reusing
workspace builds or locally packed tarballs.

The `windows-check` job uses the same pinned Node.js and pnpm versions on
`windows-latest`. It runs the repository check, packed workspace package smoke, and
diff hygiene. The Ubuntu job name remains stable for existing branch protection;
Windows coverage is a separate status that can be made required without renaming
the existing gate.

`.github/workflows/runtime-compatibility.yml` independently checks the package
runtime claim on Ubuntu. Its `minimum` job uses exact Node.js `24.0.0`; its
`current` job uses the latest stable Node.js distribution. Both run workspace type
checks and tests, packed-package smoke, and diff hygiene with the locked pnpm
version. This rolling matrix is a compatibility signal, while the pinned main CI
and release jobs remain the reproducible release baseline.

`.github/workflows/consumer-compatibility.yml` installs packed candidate artifacts
into isolated core, Node, Ajv, Zod, and CLI projects. It runs JavaScript ESM, strict
TypeScript, adapter, and installed binary checks across Ubuntu and Windows on exact
Node.js `24.0.0` and the latest stable Node.js release. Workspace links are not used
inside those consumers.

## Validation

- Required validation names: typecheck, test, smoke, check.
- Release blocker status: public API, CLI, or package-surface changes are blocked when local `check`,
  smoke, hosted CI, or runtime compatibility fails.
- Remaining operational risk: publication still runs on Ubuntu. Windows CI covers
  package behavior and smoke installation, but not the Trusted Publisher release job.
