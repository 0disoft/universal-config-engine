# Implementation Language and Package Strategy

Status: Accepted
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

Node.js `24.0.0` is the exact minimum runtime represented by that package contract.
Hosted runtime compatibility checks execute the workspace tests and packed-package
smoke on both `24.0.0` and the latest stable Node.js distribution. The rolling
latest check verifies the open upper range implied by `>=24`; the pinned `24.11.1`
main CI and release jobs remain the reproducible validation baseline. A future
upper bound or runtime-floor change requires package metadata, compatibility docs,
and this ADR to move together.

The first package is `@0disoft/universal-config-engine-core`. Package publication
uses the verified `@0disoft` npm scope. The core package must have zero
runtime dependencies and must not import file-system, process, argv, parser,
validator, or CLI presentation libraries.

Package boundaries are:

- core: config values, paths, source descriptors, merge, provenance, issues,
  redaction, diagnostics, and result contracts.
- `@0disoft/universal-config-engine-node`: JSON file, simple `.env`, process env,
  and argv helpers.
- `@0disoft/universal-config-engine-cli`: `explain` and `validate` command parsing
  and presentation.
- validator packages: optional Ajv and Zod integrations.
- repository fixtures: shared behavior cases and golden diagnostic reports.

## Resolved Follow-Ups

- ADR 0004 selects `@0disoft/universal-config-engine-cli` and binary `uce`.
- ADR 0006 keeps dialect-heavy parser integrations adapter-owned.
- ADR 0007 selects tag-driven Trusted Publisher release automation.
- `@0disoft/universal-config-engine-node` owns Node.js source adapters.
- `@0disoft/universal-config-engine-validator-ajv` and
  `@0disoft/universal-config-engine-validator-zod` are the first validator packages.

## Consequences

- Build and test commands use workspace scripts, not application server commands.
- Core implementation starts without I/O, parser, validator, or CLI dependencies.
- CLI implementation must call core instead of duplicating merge behavior.
- Publish workflow automation is decided in ADR 0007.
- License and initial version are decided in ADR 0005.

## Review Blockers

- Core adds a runtime dependency.
- Core imports Node.js file-system, process, argv, parser, validator, or CLI modules.
- Package metadata claims a publishable OSS license that differs from ADR 0005.
- Future CLI behavior bypasses the core resolution pipeline.
- Package runtime metadata claims a Node.js range not exercised at its exact floor
  and rolling upper edge.
