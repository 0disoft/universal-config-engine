# Design Review Questions

Status: Draft

## Contract

Design review questions must cover problem boundary, ownership, data/state, failure and recovery, future cost, and source-of-truth drift.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/product/03-risk-register.md`,
  `docs/architecture/00-system-boundary.md`, `docs/adr/*.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
