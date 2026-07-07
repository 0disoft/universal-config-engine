# Product Specification

Status: Draft
Owner: UNASSIGNED

## Product Contract

Universal Config Engine provides a library-first local configuration resolution
pipeline with an optional CLI for inspection and validation.

The engine must make config resolution explainable. A caller should be able to
inspect the final value, source, precedence decision, validation result, and
redaction status without reading the implementation.

The engine is not a universal parser suite. Parser support exists to feed normalized
config objects into the resolution pipeline. The product contract is the explanation
of why each final value exists.

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
- Diagnostic report: a redacted explanation surface for humans, CI, and agents. It
  may still contain sensitive names such as source ids, env var names, file paths, or
  internal service labels, so it is secret-safe, not automatically public-safe.
- Unsafe key: a path segment such as `__proto__`, `prototype`, or `constructor` that
  must not mutate prototypes during merge or override mapping.

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
- Prototype-pollution-safe path handling.
- Configurable resource limits for file size, object depth, key count, diagnostics
  count, path length, and env var count.

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
9. Provenance must be produced during resolution, not reconstructed after only the
   final object exists.
10. Redacted diagnostic structures must avoid storing raw secret values; output-time
   string replacement is not a sufficient redaction model.
11. Unsafe path segments must be rejected or escaped before merge or mapping can
   mutate object state.
12. Resource limits must produce bounded issues instead of unbounded output or
   process failure.
13. Loader exceptions must be converted into source-aware `source-load` issues
    before merge or diagnostic reporting.

## Public Surfaces

- Library API for source registration, pipeline execution, diagnostics, and validator
  adapters.
- CLI for local config explanation, validation, and machine-readable reports.
- Documentation examples showing precedence, redaction, adapter boundaries, and
  validation error paths.
- Versioned diagnostic report schema for CLI JSON output.

## Open Decisions

- Implementation language and package ecosystem: TypeScript, ESM, pnpm workspace;
  see `docs/adr/0003-implementation-language-and-package-strategy.md`.
- Runtime compatibility floor: Node.js `>=24`; see
  `docs/adr/0003-implementation-language-and-package-strategy.md`.
- Initial validator adapter examples: Zod via
  `@0disoft/universal-config-engine-validator-zod` and JSON Schema via
  `@0disoft/universal-config-engine-validator-ajv`.
- CLI command names and exact flags: see `docs/cli/command-contract.md` and
  `docs/adr/0004-cli-command-and-pipeline-declaration.md`.
- CLI validator declaration support: inline Ajv JSON Schema via `json-schema-ajv`;
  see `docs/adr/0004-cli-command-and-pipeline-declaration.md`.
- Package export shape: see `docs/library/public-api.md`.
- Repository package strategy and package manager: pnpm workspace; see
  `docs/adr/0003-implementation-language-and-package-strategy.md`.
- License and initial npm package version: MIT and `0.1.1`; see
  `docs/adr/0005-license-version-and-release-baseline.md`.
- YAML, TOML, INI, and JSON5 are adapter examples rather than first-party parser
  packages for the `0.1.x` baseline; see
  `docs/adr/0006-adapter-ecosystem-contract.md`.
