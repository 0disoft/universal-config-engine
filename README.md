# universal-config-engine

Status: Draft
Scope: backend
Repository Type: library
Addons: cli-tool

Universal Config Engine is a local configuration resolution engine. It is designed
for projects that need to explain exactly why a config value resolved to a final
value across defaults, files, environment variables, CLI arguments, and validation
layers.

The goal is not to parse every config format directly. The core owns a deterministic
pipeline, provenance model, merge policy, validation adapter boundary, and secret
redaction rules. JSON object input and simple `.env` loading are the first built-in
surfaces; YAML, TOML, INI, and JSON5 belong behind adapters unless later evidence
justifies built-in support.

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- .agents/context-map.md: agent route map
- docs/product/02-spec.md: product source of truth
- docs/library/public-api.md: library API ownership
- docs/cli/command-contract.md: CLI command behavior
- packages/cli/fixtures/: executable CLI golden report fixtures
- docs/: design, operations, architecture, and engineering standards
- archive/scaffold/: non-authoritative backend scaffold material retained only for
  reference while the product boundary settles

## Repository Shape Notes

- library: This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.
- cli-tool: This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Product Boundary

Owned:

- Config source registration and ordered resolution.
- Loader adapter contracts for file formats.
- Env var and CLI override mapping.
- Nested object merge policy with value-level provenance metadata.
- Schema validator adapter boundary.
- Diagnostic-first secret redaction for logs, CLI output, and reports.
- A CLI for explaining resolved config without printing secret values.

Not owned:

- Remote config services.
- Feature flag rollout platforms.
- Secret managers, encryption, rotation, or cloud KMS clients.
- Template rendering engines.
- Direct parsers for every config file dialect.
- Application server or database persistence behavior.

## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore keep line endings, binary diffs,
local files, build outputs, caches, and secret files under control.

## Current Decision State

The product direction is documented. ADR 0003 selects TypeScript, ESM output, Node
`>=24`, a pnpm workspace, and a zero-runtime-dependency core package. ADR 0004
selects `@universal-config-engine/cli`, binary name `uce`, commands `explain` and
`validate`, JSON pipeline declarations, and JSON report schema version `0.1`.
Initial validator adapters are `@universal-config-engine/validator-zod` and
`@universal-config-engine/validator-ajv`. License, npm publication scope, release
automation, and additional validator integrations remain UNDECIDED. The first CLI
golden fixture covers local JSON-file defaults, process env overrides, argv
overrides, provenance, and secret-path redaction. CLI fixtures also cover opt-in
coercion with declared Ajv JSON Schema validation.

## Current Structure Warning

Archived `api`, `db`, and backend documentation scaffold files are not product
contracts. They do not imply an HTTP API, database schema, migration surface, auth
model, or hosted service. Any future server or persistence surface requires a new
ADR before it can move out of `archive/scaffold/`.
