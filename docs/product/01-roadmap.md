# Roadmap

Status: Draft
Owner: UNASSIGNED

## Phase 0: Contract

- Archive non-authoritative backend scaffold material outside active product docs.
- Finalize the normalized config object model.
- Define source provenance metadata.
- Define redaction metadata and diagnostic output rules.
- Define unsafe key handling and resource limit policy.
- Define package boundaries for core, runtime source adapters, CLI, validator
  adapters, and fixtures.
- Decide implementation language, package name, and runtime floor. TypeScript, ESM,
  pnpm workspace, Node.js `>=24`, and provisional `@universal-config-engine/core`
  are selected in ADR 0003.
- Decide license, initial package version, release policy, and package publication
  strategy. MIT, `0.1.0`, and manual validation-gated release preparation are
  selected in ADR 0005; npm publication remains gated on scope ownership and
  authentication.
- Record ADRs for package, runtime, license, redaction, merge, provenance, and CLI
  report schema choices.

## Phase 1: Library MVP

- Implement JSON object pipeline.
- Add explicit source priority and nested merge policy.
- Add value-level provenance as part of merge, not as a post-processing step.
- Add unsafe key rejection and resource-limit issues.
- Add env var and CLI override mappers over normalized source objects.
- Add opt-in coercion policy.
- Add validator adapter interface.
- Add diagnostic-first secret redaction helper.
- Add examples and fixtures for precedence, coercion, validation, and redaction.

## Phase 2: Runtime Source Adapters

- Add JSON file loader.
- Add simple `.env` loader.
- Add process env source.
- Add argv source.
- Keep dialect-heavy loaders behind adapters.

## Phase 3: CLI MVP Baseline

- Implemented `explain` and `validate` commands over the shared library pipeline.
- Implemented versioned JSON output for CI and agent usage.
- Implemented exit-code taxonomy for validation, source-load, mapping, merge,
  coercion, resource-limit, usage, and redaction-policy failures.
- Added golden report fixtures for success, validation failure, secret validation
  failure, source-load failure, mapping failure, and JSON usage errors.
- Added no-secret snapshot checks and secret-path redaction regression coverage.
- Prepared package metadata and MIT license for the `0.1.0` package baseline.
- Published the `v0.1.0` GitHub release with packed package tarball assets for
  inspection before npm publication.

## Phase 4: Adapter Ecosystem

- Documented the adapter ecosystem contract in ADR 0006 without moving dialect
  parsing into core.
- Added compatibility fixtures for YAML, TOML, JSON5, and validator path mapping.
- Added `pnpm run check:adapter-fixtures` to validate adapter fixture shape.
- Published adapter examples for YAML, TOML, and JSON5 without moving dialect
  parsing into core.
- Documented how third-party validators attach error paths to normalized config
  objects.

## Explicitly Deferred

- Remote config service.
- Secret manager integrations.
- Feature flag rollout engine.
- Template rendering.
- Multi-language ports.
- Raw secret debug output.
