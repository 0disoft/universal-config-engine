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
- Decide license, release policy, and package publication strategy.
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

## Phase 3: CLI MVP

- Add command to explain final resolved config.
- Add command to validate config through a configured validator adapter.
- Add JSON output for CI and agent usage.
- Add exit-code taxonomy for parse, merge, validation, and redaction-policy failures.
- Add golden report fixtures and no-secret snapshot checks.

## Phase 4: Adapter Ecosystem

- Publish adapter examples for YAML, TOML, and JSON5 without moving dialect parsing
  into core.
- Add compatibility fixtures for adapter provenance.
- Document how third-party validators attach error paths to normalized config objects.

## Explicitly Deferred

- Remote config service.
- Secret manager integrations.
- Feature flag rollout engine.
- Template rendering.
- Multi-language ports.
- Raw secret debug output.
