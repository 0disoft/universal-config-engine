# Backup and Restore

Status: Draft

## Operational Contract

This repository does not own a database, object store, queue, or hosted runtime
state. Restore means recovering source, tags, release notes, and package artifacts
from Git, GitHub releases, local validation logs, and package tarballs.

If a release artifact is bad, follow `docs/ops/rollback.md` and publish or attach a
corrected artifact from a clean commit or tag. Do not rewrite public history after a
bad artifact has been announced.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive restore or artifact
  problems; use `SECURITY.md` if the artifact may expose secret material.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: restore or replacement release work is blocked while
  local validation, package smoke checks, secret-safety checks, or artifact
  reproduction fails.
- Remaining operational risk: npm registry unpublish and deprecation behavior is
  registry-policy dependent; prefer a validated patch or replacement release.
