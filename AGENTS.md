# AGENTS.md

## Repository Scope

Scope: backend

This repository owns a stack-neutral local configuration resolution engine for
backend, CLI, and developer-tool projects. Its core product surface is a library API
for loading config sources, applying deterministic precedence, preserving value-level
provenance, validating normalized config objects, and redacting secret values from
diagnostics.

The CLI addon owns local inspection commands for config resolution, validation,
and provenance reporting. CLI commands must stay thin wrappers around the library
contracts and must not become a remote config service.

This repository does not own frontend routing, visual design, component hierarchy,
hosted API server behavior, authentication, authorization, database persistence,
migrations, secret management, remote config delivery, or feature flag rollout
platform behavior.

Archived backend scaffold files under `archive/scaffold/` are non-authoritative
reference material. Do not treat them as implemented product contracts, source of
truth, or evidence that this repository owns an API server or database.

## Repository Shape

Primary repository type: library
Addons: cli-tool

- library: This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.
- cli-tool: This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.


## Source of Truth

- Product scope: docs/product/02-spec.md
- Product brief: docs/product/00-product-brief.md
- Public library API: docs/library/public-api.md
- CLI command contract: docs/cli/command-contract.md
- Architecture decisions: docs/adr/*.md
- Validation: VALIDATION.md
- Agent routing: .agents/context-map.md
- Repository hygiene: .editorconfig, .gitattributes, .gitignore

## Hard Rules

- Do not generate or infer application source code from this scaffold.
- Do not invent technology choices. Use UNDECIDED when a decision is not known.
- Do not create fake credentials, tokens, secrets, or private values.
- Do not rely on generated, cache, or build output as source truth.
- Do not claim YAML, TOML, INI, JSON5, or secret-manager support until an adapter
  contract, fixtures, and validation behavior are documented.
- Do not log resolved secret values. Diagnostics may report source, path, redaction
  reason, and provenance metadata, but not raw secret material.
- Do not add a raw-secret debug flag without an ADR that defines a safe mode,
  output restrictions, and test evidence.
- Do not blur config loading with feature flags, template rendering, process env
  injection, or remote configuration. Route those ideas to separate packages unless
  an ADR intentionally changes scope.
- Do not let core depend on parser, validator, file-system, process, or CLI
  libraries. Runtime and adapter dependencies belong behind package boundaries once
  those packages are decided.

## Repository Hygiene

- .editorconfig sets line ending, encoding, and final newline policy.
- .gitattributes sets Git text normalization and binary diff policy.
- .gitignore excludes local, secret, build, and cache artifacts.
- Generated, cache, and build output must not be used as design-document evidence.
- Do not create large diffs that only change line endings.

## Before Editing

- Read this file, VALIDATION.md, CHECKLIST.md, and .agents/context-map.md.
- Read the skill and checklist named by the context map.
- Confirm source-of-truth documents before changing contracts.

## Out of Scope

- Application source scaffolding.
- Runtime infrastructure such as Docker, Kubernetes, Terraform, or framework apps.
- Project-specific credentials or deployment secrets.
- HTTP API server, authentication, authorization, database schema, migrations, or
  hosted configuration delivery.

## Final Response Requirements

- List executed validations, passed validations, skipped validations, skip reasons, and remaining risk.
- Name any source-of-truth documents changed.
- Call out API, DB, repository hygiene, and runner changes explicitly.
