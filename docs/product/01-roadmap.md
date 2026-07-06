# Roadmap

Status: Draft
Owner: UNASSIGNED

## Phase 0: Contract

- Finalize the normalized config object model.
- Define source provenance metadata.
- Define redaction metadata and diagnostic output rules.
- Decide implementation language, package name, and runtime floor.
- Record the first ADR for package and runtime choices.

## Phase 1: Library MVP

- Implement JSON object pipeline.
- Add JSON file loader.
- Add simple `.env` loader.
- Add explicit source priority and nested merge policy.
- Add env var and CLI override mappers.
- Add validator adapter interface.
- Add secret redaction helper.
- Add examples and fixtures for precedence, coercion, validation, and redaction.

## Phase 2: CLI MVP

- Add command to explain final resolved config.
- Add command to validate config through a configured validator adapter.
- Add JSON output for CI and agent usage.
- Add exit-code taxonomy for parse, merge, validation, and redaction-policy failures.

## Phase 3: Adapter Ecosystem

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
