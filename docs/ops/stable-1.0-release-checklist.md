# Stable 1.0 Release Checklist

Status: Pending Review Window
Candidate: `1.0.0-rc.2`
Stable Version: `1.0.0`
Not Before: `2026-07-22T04:19:37Z`

## Purpose

Promote the reviewed RC2 package contents without slipping unreviewed runtime,
public API, package-content, dependency, or release-runner changes into stable
`1.0.0`.

## Allowed Stable Preparation Diff

The stable preparation commit may change only:

- the five publishable package versions from `1.0.0-rc.2` to `1.0.0`;
- current-version and installation examples that must name `1.0.0`;
- `CHANGELOG.md` to finalize the stable heading and publication date;
- release, roadmap, migration, and stability status documentation.

Any change to runtime source, public declarations, package READMEs, dependencies,
fixtures, smoke logic, release workflow, release scripts, or package file contents
requires another release candidate and a restarted review period.

## Review Window Gate

- [ ] Current UTC time is at or after `2026-07-22T04:19:37Z`.
- [ ] `release-policy.json` still names `1.0.0-rc.2` and `168` review hours.
- [ ] No open issue confirms a breaking API, runtime, packaging, or security blocker.
- [ ] npm `next` still points all five packages to `1.0.0-rc.2`.
- [ ] npm `latest` still points all five packages to `0.6.0` before stable publish.
- [ ] The stable release readiness script passes against current GitHub and npm state.

## Preparation And Local Validation

- [ ] Apply only the allowed stable preparation diff.
- [ ] Confirm all five package versions are exactly `1.0.0`.
- [ ] Finalize the `1.0.0` CHANGELOG date and links.
- [ ] Review `docs/releases/v1.0.0.md` against the prepared package contents.
- [ ] Run the repository `check` validation.
- [ ] Run packed package and consumer-matrix smoke validations serially.
- [ ] Run workflow validation, dependency audit, repository diff hygiene, and
  scaffold health checks.
- [ ] Commit and push the stable preparation commit with a clean worktree.

## Hosted And Dry-Run Validation

- [ ] Main CI succeeds on the stable preparation SHA.
- [ ] Runtime Compatibility succeeds on exact Node.js `24.0.0` and current Node.js.
- [ ] Consumer Compatibility succeeds on Ubuntu and Windows.
- [ ] `release.yml` dry-run for `v1.0.0` succeeds from the same SHA.
- [ ] The dry-run stable gate installs and smokes exact RC2 registry packages.

## Publication

- [ ] Confirm `1.0.0` is absent for all five packages before tagging.
- [ ] Create and push annotated tag `v1.0.0` from the validated SHA.
- [ ] Confirm the GitHub Release is published, non-draft, and not a prerelease.
- [ ] Confirm all five tarballs and before/after publication manifests are attached.
- [ ] Confirm the after manifest reports `5/5` published and `complete=true`.
- [ ] Confirm npm `latest` points all five packages to `1.0.0`.
- [ ] Confirm npm `next` still points all five packages to `1.0.0-rc.2`.
- [ ] Confirm package README metadata, integrity, and SLSA provenance.
- [ ] Run the exact `1.0.0` public-registry package smoke.

## Failure Handling

Do not move or overwrite a published tag. If publication is partial, preserve the
publication manifests and rerun the same tagged workflow. If a defect is found
before stable publication, stop and prepare another release candidate. If a defect
is found after publication, deprecate the affected version when appropriate and
publish a forward-fix patch under the rollback contract.
