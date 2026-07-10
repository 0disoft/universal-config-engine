# ADR 0009: Validator Typed Output Boundary

Status: Accepted
Owner: UNASSIGNED

## Purpose

Decide whether `ValidatorResult.value` replaces the resolved pipeline config or
becomes the input to later validators.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public library API: `docs/library/public-api.md`
- Adapter contract: `docs/adr/0006-adapter-ecosystem-contract.md`
- Core types: `packages/core/src/types.ts`

## Decision

`ValidatorResult.value` is adapter-local typed output. Core records validator
issues and provenance, but it does not write the value back to `ConfigResult.config`
and does not pass it to later validators.

Every validator in one run receives an isolated, read-only view of the same resolved
config. Validator ordering therefore affects issue and provenance order only; it
does not create an implicit transformation pipeline.

A future feature that intentionally transforms resolved config must use a separate
stage and public API with its own ordering, provenance, failure, redaction, and type
ownership contract. It must not be introduced by changing validator behavior in
place.

## Rationale

Validator libraries commonly return parsed, defaulted, stripped, or coerced values.
Those behaviors differ by library and schema options. Applying such values inside
the validator boundary would make config resolution depend on validator order and
would hide transformations from the existing merge and coercion provenance model.

Keeping typed output local preserves deterministic resolution and lets adapter
consumers use a validator's typed result directly when they call that adapter. Core
remains responsible for validation reporting, not application-specific type
construction.

## Consequences

- `ConfigResult.config` remains the result of load, mapping, merge, and declared
  coercion only.
- Later validators cannot observe defaults, coercions, stripping, or transforms
  returned by earlier validators.
- Adapter authors may expose typed helper APIs outside `runValidators` when callers
  need the validator library's typed result.
- Adding a transform stage later requires a new ADR and a compatibility review.

## Validation

- Core tests must prove that validator-returned values do not replace pipeline
  config.
- Core tests must prove that later validators receive the original resolved config.
- Public API and adapter documentation must describe typed output as adapter-local.

## Review Blockers

- Core replaces resolved config with `ValidatorResult.value`.
- A validator's typed value becomes another validator's input.
- Validator-returned transforms bypass coercion provenance or redaction policy.

