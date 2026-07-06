# Initial Architecture Boundaries

Status: Draft
Owner: UNASSIGNED

## Purpose

This document captures the initial architecture boundary for Universal Config Engine.
It records the current product direction before implementation begins.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related documents:
  - `docs/architecture/00-system-boundary.md`
  - `docs/architecture/01-domain-model.md`
  - `docs/architecture/02-runtime-flow.md`
  - `docs/library/public-api.md`
  - `docs/cli/command-contract.md`

## Decision

Universal Config Engine is a local configuration resolution library plus a thin CLI
inspection surface. It is not a hosted API, remote config service, feature flag
platform, secret manager, database-backed application, or parser collection.

The architecture centers on explaining why a final config value exists. Owned
behavior includes source registration, normalized config values, explicit priority,
declared override mappings, deterministic merge, value-level provenance, opt-in
coercion, validator adapter handoff, diagnostic-first redaction, and CLI explanation.

Parser and validator integrations belong behind adapters. Runtime source helpers,
CLI presentation, and validator adapters must not leak into core.

## Consequences

- Provenance must be produced during resolution, not reconstructed after the final
  object exists.
- Redacted diagnostics must avoid storing raw secret values.
- Core must stay independent from file-system, process env, argv, parser, validator,
  and CLI dependencies.
- Archived backend scaffold material under `archive/scaffold/` is not product scope.
- Future HTTP API, database, remote config, feature flag, or secret manager behavior
  requires a new ADR.

## Deferred Decisions

- Implementation language and runtime floor.
- Package manager and package names.
- License and release automation.
- First validator adapter.
- Whether dialect-heavy parser adapters are first-party packages or examples.

## Review Blockers

- The change invents a product domain without a source.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
- The change treats archived scaffold files as active API or DB contracts.
- The change adds core dependencies that belong behind adapters.
