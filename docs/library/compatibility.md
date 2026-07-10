# Compatibility

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public API: `docs/library/public-api.md`
- Semantic versioning: `docs/library/semver.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Compatibility Goals

Universal Config Engine should be usable by CLIs, server-side tools, build tools,
and libraries that need local config resolution. The core should avoid coupling to
one parser, one validator, one framework, or one remote service.

## Compatibility Boundaries

- Parser compatibility is owned by loader adapters.
- Validator compatibility is owned by validator adapters.
- Packed-package smoke validation compiles and runs a pre-0.3
  `ConfigIssue[]`-returning validator fixture against the current core types.
- Runtime compatibility floor is Node.js `>=24`.
- Package module format is ESM.
- CLI JSON output compatibility is governed by `docs/cli/output-and-exit-codes.md`.
- CLI JSON diagnostic reports carry schema version `0.1`; schema field changes are
  compatibility changes for CI and agent consumers.
- Core dependency compatibility should prefer a minimal or zero runtime dependency
  surface until package boundaries are decided.

## Compatibility Risks

- Changing merge order can change runtime behavior for consumers.
- Changing redaction defaults can leak or hide data unexpectedly.
- Changing adapter interfaces can break third-party parser or validator integrations.
- Claiming support for a parser dialect without fixtures can create false compatibility.
- Adding parser, validator, or CLI dependencies to core can make consumers install
  unused runtime code.
- Changing report field names can break CI and agent integrations even if human
  output still looks readable.

## Review Blockers

- Compatibility claims lack runtime, fixture, or consumer evidence.
- A required parser or validator dependency is introduced without an ADR.
- Package artifacts drift from documented public API.
- Core imports file-system, process, parser, validator, or CLI dependencies.
