# Secrets

Status: Draft

## Operational Contract

This repository does not own secret storage, encryption, rotation, cloud KMS, Vault,
or deployment credential management. It owns secret-safe diagnostics: raw secret
values must not be logged, serialized into reports, committed in fixtures, copied
into package artifacts, or exposed through CLI output.

Secret metadata may identify source ids, paths, env var names, and redaction
reasons. A redacted report is still not automatically public-safe.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: `SECURITY.md` for suspected secret exposure; repository issues
  only for non-sensitive redaction contract questions.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: release is blocked when tracked files, fixtures, package
  artifacts, CLI JSON, thrown errors, or diagnostic reports expose raw secret
  values.
- Remaining operational risk: actual secret inventory, access, and rotation remain
  consumer-owned outside this library.
