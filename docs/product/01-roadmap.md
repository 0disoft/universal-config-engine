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
  pnpm workspace, Node.js `>=24`, and `@0disoft/universal-config-engine-core`
  are selected in ADR 0003.
- Decide license, initial package version, release policy, and package publication
  strategy. MIT, `0.1.1`, the `@0disoft` npm scope, and the manual release baseline
  are selected in ADR 0005; ADR 0007 adds routine Trusted Publisher automation.
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
- Prepared package metadata and MIT license for the `0.1.1` package baseline.
- Published the `v0.1.0` GitHub release with packed package tarball assets for
  pre-publication inspection.

## Phase 4: Adapter Ecosystem

- Documented the adapter ecosystem contract in ADR 0006 without moving dialect
  parsing into core.
- Added compatibility fixtures for YAML, TOML, JSON5, and validator path mapping.
- Added `pnpm run check:adapter-fixtures` to validate adapter fixture shape.
- Published adapter examples for YAML, TOML, and JSON5 without moving dialect
  parsing into core.
- Documented how third-party validators attach error paths to normalized config
  objects.

## Phase 5: 0.2.x Contract Hardening

- Bounded CLI file sources to the pipeline declaration directory.
- Rebuilt validated CLI declarations into typed runtime-owned objects.
- Unified diagnostic overflow semantics so the marker counts toward
  `maxDiagnostics`.
- Generalized unscoped validator diagnostic text before it enters reports.
- Fixed validator typed output as adapter-local behavior in ADR 0009.
- Added a repeatable merge path trie benchmark near the 10,000-key resource limit.

## Phase 6: 0.3.x Consumer API

- Added executable package-consumer quickstarts.
- Added `runConfigPipeline` as a high-level load, resolve, validate, and report
  facade while preserving independently callable core stages.
- Added Windows package verification to hosted CI.
- Replaced validator-provided diagnostic prose with structured validator issues
  normalized by core.
- Verified configured file roots against the opened file handle before reading
  JSON or dotenv contents.

## Phase 7: 0.4.x Runtime Boundary Hardening

- Omitted raw exception text across loader, parser, mapping, coercion, validator,
  and CLI declaration failure paths.
- Distinguished JSON file read failures from parse failures.
- Bounded pipeline declaration bytes before parsing and process environment or argv
  entry counts before mapping.
- Added optional per-source `maxEnvEntries` and `maxArgvEntries` policies.
- Bounded loader issue retention per source and in aggregate from the loader boundary.
- Normalized invalid direct-library resource limits to safe documented defaults.
- Validated loader issue and location result structures and bound their source identity
  to the loader descriptor.
- Converted hostile source value inspection exceptions into stable parse issues.
- Indexed duplicate CLI mapping target paths for linear declaration validation.

## Phase 8: 0.5.x Observability And Execution Budgets

- Define aggregate execution budgets for source count, retained provenance, resolved
  paths, and serialized diagnostic report bytes before adding new report fields.
- Preserve bounded loader source locations through resolution and diagnostics with a
  versioned public report-schema change.
- Add bounded provenance and coercion summaries to human `explain` output.
- Decide an opt-in strict policy for unmapped process environment and argv entries;
  the default must preserve compatibility and avoid treating unrelated host input as
  configuration errors.
- Converge CLI orchestration on the public pipeline facade without weakening the
  declaration-specific diagnostic and exit-code contracts.
- Define resumable partial-publication evidence for the five-package release because
  npm publication cannot be atomic.
- Record and test the supported Node.js runtime matrix independently from the package
  manager and CI runner pins.

## Explicitly Deferred

- Remote config service.
- Secret manager integrations.
- Feature flag rollout engine.
- Template rendering.
- Multi-language ports.
- Raw secret debug output.
