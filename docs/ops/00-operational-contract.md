# Operational Contract

Status: Draft

## Operational Contract

Universal Config Engine is operated as an OSS library and CLI package, not as a
hosted service. The critical operational journeys are local validation, package
release preparation, GitHub release artifact inspection, and npm publication.

There is no runtime SLO, hosted health check, RTO, RPO, tenant boundary, database,
or background job owned by this repository. Operational blocking conditions are
local validation failure, hosted CI failure, package smoke failure, secret exposure,
unreproducible release assets, and unconfirmed `@0disoft` authentication.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive package or documentation
  failures; use `SECURITY.md` for suspected secret exposure or vulnerability reports.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: release is blocked when local `check`, package smoke,
  hosted CI, secret-safety checks, or release artifact reproduction fails.
- Remaining operational risk: npm publication is manual until Trusted Publisher or
  another automated release credential path is documented.
