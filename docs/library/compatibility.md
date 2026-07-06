# Compatibility

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public API: `docs/library/public-api.md`
- Semantic versioning: `docs/library/semver.md`
- Technical owner: UNASSIGNED
- Related ADR: UNDECIDED

## Compatibility Goals

Universal Config Engine should be usable by CLIs, server-side tools, build tools,
and libraries that need local config resolution. The core should avoid coupling to
one parser, one validator, one framework, or one remote service.

## Compatibility Boundaries

- Parser compatibility is owned by loader adapters.
- Validator compatibility is owned by validator adapters.
- Runtime compatibility floor is UNDECIDED.
- Package module format is UNDECIDED.
- CLI JSON output compatibility is governed by `docs/cli/output-and-exit-codes.md`.

## Compatibility Risks

- Changing merge order can change runtime behavior for consumers.
- Changing redaction defaults can leak or hide data unexpectedly.
- Changing adapter interfaces can break third-party parser or validator integrations.
- Claiming support for a parser dialect without fixtures can create false compatibility.

## Review Blockers

- Compatibility claims lack runtime, fixture, or consumer evidence.
- A required parser or validator dependency is introduced without an ADR.
- Package artifacts drift from documented public API.
