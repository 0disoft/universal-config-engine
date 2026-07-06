# Contract Source of Truth

Status: Draft
Owner: UNASSIGNED

## Purpose

This document records where product, library, CLI, security, test, and archived
scaffold contracts live.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0001-initial-architecture-boundaries.md`

## Decision

Active source-of-truth documents are:

- Product identity and scope: `docs/product/00-product-brief.md`
- MVP contract and open decisions: `docs/product/02-spec.md`
- Architecture boundary: `docs/architecture/00-system-boundary.md`
- Domain model: `docs/architecture/01-domain-model.md`
- Runtime flow: `docs/architecture/02-runtime-flow.md`
- Public library API direction: `docs/library/public-api.md`
- CLI command behavior: `docs/cli/command-contract.md`
- CLI output and exit codes: `docs/cli/output-and-exit-codes.md`
- Security baseline: `docs/engineering/04-security-baseline.md`
- Testing standard: `docs/engineering/05-testing-standard.md`
- Validation names: `VALIDATION.md`

Non-authoritative scaffold material lives under `archive/scaffold/`. It is retained
for history and must not be used as evidence that this repository owns an HTTP API,
database schema, authentication model, authorization model, migration system, hosted
service, or persistence layer.

## Contract Rules

- CLI behavior must follow the library pipeline rather than a separate resolution
  path.
- JSON report compatibility requires a report schema version before stable use.
- Redacted reports are secret-safe, not automatically public-safe.
- Parser and validator support claims require adapter contracts and fixtures.
- Implementation language, runtime, package manager, package names, license, and
  release automation remain undecided until ADRs record them.

## Review Blockers

- The change invents a product domain without a source.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
- The change cites `archive/scaffold/` as active product authority.
- The change changes CLI JSON fields without updating the report contract.
