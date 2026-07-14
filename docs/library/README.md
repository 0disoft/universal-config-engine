# Library

Status: Draft
Repository Type: library

## Repository Type Contract

The library owns the reusable config pipeline. Public APIs must make source priority,
merge behavior, validator handoff, provenance, and redaction behavior explicit.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Required Decisions

- Public API ownership: normalized config pipeline, loader adapter contract, provenance
  report, redaction metadata, validator adapter contract.
- Semantic versioning policy: public type names, exported functions, diagnostic shape,
  and adapter interfaces are semver-governed.
- Runtime and platform compatibility: Node.js `>=24` and ESM output.
- Package artifact and export surface: package `exports` point at built `dist`
  JavaScript and declaration files.
- Deprecation and migration policy: deprecations must include migration examples before
  removal.

## Migration Guides

- `docs/library/migration-0.3.md`: migrate package consumers from `0.2.1` to the
  current `0.3.x` release.
- `docs/library/migration-0.4.md`: migrate consumers to the `0.4.0` runtime boundary
  hardening release.
- `docs/library/migration-0.5.md`: migrate consumers to the current `0.5.0`
  observability and execution-budget release.

## Stable Release Planning

- `docs/library/public-api-stability.md`: `v0.5.0` export classification and
  candidate review inventory.
- `docs/library/stability-1.0.md`: public-surface audit, adversarial evidence,
  consumer matrix, and release gates required before `1.0.0-rc.1`.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- A parser or validator dependency is made mandatory without an ADR.
- A diagnostic API can expose raw secret values by default.
