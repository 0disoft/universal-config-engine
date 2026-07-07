# Observability

Status: Draft

## Operational Contract

This repository does not own service logs, metrics, traces, dashboards, alerts, or
runtime health checks. Observability means local diagnostic quality: CLI JSON
reports, source identity, provenance, issue categories, redaction metadata, package
smoke output, and CI logs.

Diagnostic reports are secret-safe by design but not automatically public-safe.
They may contain source ids, env var names, file paths, or internal service labels.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive diagnostic quality problems;
  use `SECURITY.md` for diagnostics that may expose sensitive data.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: release is blocked when diagnostics lose schema version,
  source identity, provenance, exit-code mapping, or redaction guarantees.
- Remaining operational risk: consumers own their own log retention, alerting, and
  dashboard policies when embedding the library or CLI in larger systems.
