# Config and Environment

Status: Draft

## Operational Contract

This repository owns local library and CLI configuration behavior, not deployment
environment management. Runtime config inputs are normalized sources such as object
values, JSON files, simple `.env` files, process env mappings, argv mappings, and
adapter-provided objects.

Config mappings must be explicit. CLI declarations use JSON for the `0.1.x`
baseline; non-JSON declaration formats remain deferred. Environment and argv values
must not be inferred from arbitrary names.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive config contract drift; use
  `SECURITY.md` for secret-handling or leak reports.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: config behavior changes are blocked when tests, CLI
  fixtures, adapter fixtures, secret-safety checks, or package smoke checks fail.
- Remaining operational risk: project-specific environment naming conventions remain
  caller-owned and must be mapped explicitly by consumers.
