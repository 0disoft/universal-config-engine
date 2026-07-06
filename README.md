# universal-config-engine

Status: Draft
Scope: backend
Repository Type: library
Addons: cli-tool

Universal Config Engine is a small configuration loading and composition toolkit.
It is designed for projects that need to explain exactly why a config value resolved
to a final value across defaults, files, environment variables, CLI arguments, and
validation layers.

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
- docs/: design, operations, architecture, and engineering standards

## Repository Shape Notes

- library: This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.
- cli-tool: This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Product Boundary

Owned:

- Config source registration and ordered resolution.
- Loader adapter contracts for file formats.
- Env var and CLI override mapping.
- Nested object merge policy with provenance metadata.
- Schema validator adapter boundary.
- Secret redaction markers for diagnostics and reports.
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

The product direction is documented, but implementation language, package manager,
runtime support floor, and concrete schema validator integrations remain UNDECIDED.
Do not invent those choices without an ADR or owner decision.
