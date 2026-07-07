# Incident Response

Status: Draft

## Operational Contract

Incidents for this repository are package, CLI, documentation, release, or security
events. There is no hosted runtime incident process because the repository does not
operate a service.

For non-sensitive incidents, preserve the commit, tag, release URL, package
artifact name, CI run, command output, and reproduction steps in a repository issue.
For suspected secret exposure or vulnerability reports, use `SECURITY.md` and do
not paste credentials, raw secret values, or private reports into public issues.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive incidents; `SECURITY.md` for
  sensitive security or secret-exposure incidents.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: releases are blocked while an unresolved incident affects
  package correctness, CLI output correctness, validation reliability, or secret
  safety.
- Remaining operational risk: response timing is maintainer-driven until a formal
  security policy with service-level commitments is added.
