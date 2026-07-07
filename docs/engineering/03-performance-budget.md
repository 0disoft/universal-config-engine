# Performance Budget

Status: Draft

## Contract

Performance budgets track local resolution cost, source size, object depth, key
count, path length, diagnostics count, env var count, package size, and CLI
execution behavior. Query count, cache behavior, background jobs, and hosted runtime
SLOs are out of scope until a future ADR adds a service surface.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/architecture/03-quality-attributes.md`,
  `docs/library/public-api.md`, `docs/ops/ci.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
