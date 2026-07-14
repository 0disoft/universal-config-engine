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

## Test Dependency Baseline

`fast-check` `4.9.0` is a root development dependency used only by bounded,
deterministic generated invariant tests. The dependency was reviewed on 2026-07-14:

- need: reproducible seeds, shrinking, and minimum failing examples are not provided
  by hand-written random loops or the existing Vitest dependency;
- license and runtime: MIT and Node.js `>=12.17`, within the repository runtime;
- dependency surface: one direct dependency, `pure-rand`; no publishable package
  runtime dependency or tarball content is added;
- maintenance: the reviewed npm release was published in July 2026 from the public
  `dubzzz/fast-check` repository;
- rollback: remove the generated test file and root dev dependency; no production
  API or package consumer migration is involved.

The lockfile pins the resolved package graph. Dependency updates require the same
license, security, and generated-test reproducibility review.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
