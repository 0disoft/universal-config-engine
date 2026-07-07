# Dependency and Change Policy

Status: Draft

## Contract

Dependency policy covers necessity, alternatives, license, maintenance health, vulnerabilities, runtime impact, bundle impact, major upgrade policy, and removal cost.

## Required Evidence

- Source of truth: `docs/adr/0003-implementation-language-and-package-strategy.md`,
  `docs/adr/0006-adapter-ecosystem-contract.md`, `docs/library/public-api.md`,
  `docs/ops/release.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
