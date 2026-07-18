# CI

Status: Draft

## Operational Contract

Cover required checks, branch protection, pipeline stages, artifacts, failure policy, local parity, and stop conditions.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive failures; SECURITY.md for sensitive failures

## Repository Governance

GitHub repository settings are the live source of truth for enforcement. This
document records the intended policy so changes to remote settings can be reviewed
against the workflow contract.

- GitHub Actions is enabled for the repository, and every remote action is required
  by the platform to use a full-length commit SHA. The repository workflow guard
  remains a second line of defense.
- The active [`Protect main`](https://github.com/0disoft/universal-config-engine/rules/19141495)
  ruleset targets the default branch. Changes must arrive through a pull request,
  all review conversations must be resolved, and the branch must retain linear
  history. The ruleset blocks branch deletion and force pushes.
- The pull-request rule requires zero approvals because the repository currently has
  one administrator and no backup owner. It still requires the pull-request audit
  trail and cannot be satisfied by a direct push.
- Repository auto-merge is enabled so a pull request can complete with squash or
  rebase after every ruleset requirement passes. Auto-merge does not bypass a
  required check or unresolved review conversation.
- Required checks must pass on the latest default-branch state and must originate
  from the GitHub Actions application. The required contexts are:
  - `check`
  - `windows-check`
  - `analyze-javascript-typescript`
  - `node-runtime-minimum`
  - `node-runtime-current`
  - `packed-consumer-ubuntu-minimum`
  - `packed-consumer-ubuntu-current`
  - `packed-consumer-windows-minimum`
  - `packed-consumer-windows-current`
- Third-party advisory checks such as `Socket Security: Project Report` are not
  merge requirements. Their outages must not prevent an otherwise validated
  security fix from merging.
- The active [`Protect release tags`](https://github.com/0disoft/universal-config-engine/rules/19141487)
  ruleset allows new `v*` tags but prevents existing release tags from being
  updated or deleted.

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
- immutable GitHub Actions reference guard
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
diff hygiene. Both `check` and `windows-check` are required by the default-branch
ruleset and their job names are part of the repository governance contract.

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

`.github/workflows/codeql.yml` runs CodeQL advanced setup for
`javascript-typescript` on `main` pushes, pull requests targeting `main`, a weekly
schedule, and manual dispatch. It uses the `security-extended` query suite and
uploads results with only `contents: read` and `security-events: write` permissions.
The workflow does not build or publish packages.

Every remote action in `.github/workflows/*.yml` must use a full 40-character
commit SHA. `pnpm run check:workflow-actions` tests this policy and scans all
workflow files; local actions remain repository-bound, and Docker actions must use
a `sha256` digest. Run `actionlint` separately when workflow structure changes.

## Validation

- Required validation names: typecheck, test, smoke, check.
- Release blocker status: public API, CLI, or package-surface changes are blocked when local `check`,
  smoke, hosted CI, runtime compatibility, consumer compatibility, or CodeQL fails.
- Remaining operational risks:
  - publication still runs on Ubuntu. Windows CI covers package behavior and smoke
    installation, but not the Trusted Publisher release job;
  - the repository still has no backup owner, so recovery from a mistaken remote
    ruleset change depends on the primary administrator retaining account access.
