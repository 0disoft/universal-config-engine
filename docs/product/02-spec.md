# Product Specification

Status: Draft
Owner: UNASSIGNED

## Product Contract

Universal Config Engine provides a library-first configuration pipeline with an
optional CLI for inspection and validation.

The engine must make config resolution explainable. A caller should be able to
inspect the final value, source, precedence decision, validation result, and
redaction status without reading the implementation.

## Core Concepts

- Config source: a named input such as defaults, JSON file, `.env` file, environment
  variables, CLI overrides, or adapter-provided objects.
- Loader: a component that turns one source into a normalized config object plus
  source metadata.
- Pipeline: the ordered sequence that loads, merges, coerces, validates, and reports
  config.
- Provenance: metadata explaining where a value came from and which source or override
  replaced it.
- Secret metadata: markers that allow diagnostics to redact sensitive values while
  still reporting source, path, and reason.
- Validator adapter: a boundary for JSON Schema, Zod-like, Valibot-like, custom, or
  future validators without making one validator mandatory.

## MVP Scope

- JSON object input pipeline.
- JSON file loader.
- Simple `.env` loader.
- Loader adapter interface for YAML, TOML, INI, and JSON5.
- Env var override mapper.
- CLI argument override mapper.
- Nested key merge.
- Explicit deep merge policy.
- Typed coercion hook.
- Default value handling.
- Schema validator adapter interface.
- Config provenance metadata.
- Secret redaction helper for diagnostics.
- CLI command to explain resolved config and validation results.

## Deferred Scope

- Built-in YAML, TOML, INI, or JSON5 parser implementations.
- Cloud secret manager integrations.
- Encryption and secret rotation.
- Remote config delivery.
- Feature flag rollout evaluation.
- Template rendering.
- Multi-language packages.
- Package manager config compatibility.

## Required Behaviors

1. Source priority must be explicit and reproducible.
2. Loader output must preserve enough source metadata to explain validation errors.
3. Env var and CLI override mapping must be declared, not inferred from arbitrary
   object paths.
4. Type coercion must be opt-in or policy-driven; silent coercion is not allowed.
5. Merge conflicts must be explainable in diagnostics.
6. Secret values must be redacted by default in CLI and log-oriented output.
7. Validator adapters must receive normalized config objects, not raw parser text.
8. Adapter failures must preserve source identity and failure category.

## Public Surfaces

- Library API for source registration, pipeline execution, diagnostics, and validator
  adapters.
- CLI for local config explanation, validation, and machine-readable reports.
- Documentation examples showing precedence, redaction, adapter boundaries, and
  validation error paths.

## Open Decisions

- Implementation language and package ecosystem: UNDECIDED.
- Runtime compatibility floor: UNDECIDED.
- First validator adapter example: UNDECIDED.
- CLI command names and exact flags: see `docs/cli/command-contract.md`.
- Package export shape: see `docs/library/public-api.md`.
