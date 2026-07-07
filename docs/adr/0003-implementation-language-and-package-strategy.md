# Implementation Language and Package Strategy

Status: Draft
Owner: UNASSIGNED

## Purpose

This document records the first implementation choices for Universal Config Engine.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Architecture boundary: `docs/adr/0001-initial-architecture-boundaries.md`
- Public API direction: `docs/library/public-api.md`
- Testing standard: `docs/engineering/05-testing-standard.md`

## Decision

The initial implementation uses TypeScript, ESM package output, Node.js `>=24`, and
a pnpm workspace.

The first package is `@universal-config-engine/core`. The package name is
provisional until npm scope ownership is confirmed. The core package must have zero
runtime dependencies and must not import file-system, process, argv, parser,
validator, or CLI presentation libraries.

Package boundaries are:

- core: config values, paths, source descriptors, merge, provenance, issues,
  redaction, diagnostics, and result contracts.
- runtime source adapters: future JSON file, simple `.env`, process env, and argv
  helpers.
- CLI: future `explain` and `validate` command parsing and presentation.
- validator adapters: future optional validator integrations.
- fixtures: future shared behavior cases and golden diagnostic reports.

## Not Decided

- npm publication scope and release automation.
- First validator adapter.
- Runtime source package names.
- CLI package name and binary name.
- Whether dialect-heavy parser adapters are first-party packages or examples.

## Consequences

- Build and test commands use workspace scripts, not application server commands.
- Core implementation starts without I/O, parser, validator, or CLI dependencies.
- CLI implementation must call core instead of duplicating merge behavior.
- Publish workflow remains blocked until a separate ADR decides automation.
- License and initial version are decided in ADR 0005.

## Review Blockers

- Core adds a runtime dependency.
- Core imports Node.js file-system, process, argv, parser, validator, or CLI modules.
- Package metadata claims a publishable OSS license that differs from ADR 0005.
- Future CLI behavior bypasses the core resolution pipeline.
