# Diagrams

Status: Draft
Owner: UNASSIGNED

## Purpose

Diagrams describe the local configuration resolution engine. They must not imply a
hosted API, authentication system, authorization system, database, or remote config
service.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0001-initial-architecture-boundaries.md`

## Required Decisions

- Boundary: local resolution library plus CLI inspection surface
- Data ownership: config values, provenance metadata, diagnostics, and report schema
- Failure and recovery behavior: source-aware issues and redacted diagnostics
- Validation needed before merge: VALIDATION.md

## Active Diagrams

- `system-context.mmd`: product boundary.
- `container-view.mmd`: package boundary direction.
- `core-runtime-flow.mmd`: resolution pipeline.
- `data-model.mmd`: explanation-first domain model.
- `resolution-lifecycle.mmd`: CLI/library run lifecycle.
- `release-flow.mmd`: release decision flow.
- `rollback-flow.mmd`: package or contract rollback flow.

Archived auth and authorization scaffold diagrams live under `archive/scaffold/`.

## Review Blockers

- The change invents a product domain without a source.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
- The diagram implies an API server, DB, auth model, or hosted service without an ADR.
