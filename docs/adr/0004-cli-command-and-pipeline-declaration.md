# CLI Command and Pipeline Declaration

Status: Draft
Owner: UNASSIGNED

## Purpose

This document records the first CLI implementation contract.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- CLI command contract: `docs/cli/command-contract.md`
- CLI configuration: `docs/cli/configuration.md`
- CLI output and exit codes: `docs/cli/output-and-exit-codes.md`

## Decision

The first CLI package is `@universal-config-engine/cli` with binary name `uce`.

The first commands are:

- `uce explain --config <pipeline.json>`
- `uce validate --config <pipeline.json>`

Both commands execute the same local resolution pipeline. The CLI does not own merge,
mapping, coercion, validation, redaction, or source-loading semantics. It calls
`@universal-config-engine/core` and `@universal-config-engine/node`.

Pipeline declaration files are JSON. The declaration may include:

- object sources;
- JSON file sources;
- simple dotenv file sources;
- process env sources with declared mappings;
- argv sources with declared mappings;
- Ajv JSON Schema validators;
- coercion rules;
- resource limits.

The CLI validates the declaration shape before source loading. Unsupported source
kinds, unknown declaration fields, missing or duplicate source ids, missing file
paths, malformed redaction policies, malformed override mappings, malformed
coercion rules, malformed validator declarations, duplicate validator ids,
malformed resource limits, and malformed file size policies are source-loading
failures. The CLI must not silently ignore unknown source kinds or unknown
declaration fields.

CLI argv source values must appear after `--`, so CLI options do not get mixed with
configuration override arguments.

JSON output carries diagnostic report schema version `0.1` plus the command name.

The first CLI validator declaration kind is `json-schema-ajv`. It accepts an inline
JSON Schema object or boolean schema and runs through
`@universal-config-engine/validator-ajv`. The CLI does not dynamically import
validator modules from file paths or package names. Zod and custom validators remain
library API integrations until a separate ADR defines a safe declaration format.

## Exit Codes

- `0`: success.
- `1`: validation failed.
- `2`: source loading or parser adapter failed.
- `3`: merge, override, coercion, mapping, or resource-limit policy failed.
- `4`: CLI usage error.
- `5`: redaction policy failure.

## Deferred

- Full resolved config printing.
- Raw secret debug output.
- Non-JSON pipeline declaration formats.
- Shell completions.

## Review Blockers

- CLI implements merge, mapping, coercion, validation, or redaction logic directly.
- CLI reads argv override values before the `--` separator.
- CLI dynamically imports validator code from a pipeline declaration.
- CLI silently skips an unsupported source kind.
- JSON output omits schema version.
- Output includes raw secret values.
