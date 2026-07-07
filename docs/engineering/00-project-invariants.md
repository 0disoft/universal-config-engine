# Project Invariants

Status: Draft

## Contract

Project invariants define what must remain true across implementation, tests, docs, configuration, and release behavior.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/library/public-api.md`,
  `docs/cli/command-contract.md`, `docs/architecture/00-system-boundary.md`,
  `docs/adr/*.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
