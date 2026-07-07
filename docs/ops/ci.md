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
- build output cleanup

The smoke commands verify package buildability and package contents for the core, node, CLI, and
validator packages.

## Hosted Workflow

GitHub Actions runs `.github/workflows/ci.yml` on `main` pushes and pull requests. The workflow:

- checks out the repository
- installs Node.js 24.11.1
- enables pnpm 11.7.0 through Corepack
- installs the locked dependency graph
- runs `pnpm run check`
- runs `pnpm run smoke:core-package`
- runs `pnpm run smoke:packages`
- runs `git diff --check`

## Validation

- Required validation names: typecheck, test, smoke, check.
- Release blocker status: public API, CLI, or package-surface changes are blocked when local `check`,
  smoke, or hosted CI fails.
- Remaining operational risk: hosted CI covers one Ubuntu runner; future OS-specific file-system,
  environment, or shell behavior still needs targeted validation before release.
