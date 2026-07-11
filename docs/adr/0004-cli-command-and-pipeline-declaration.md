# CLI Command and Pipeline Declaration

Status: Accepted
Owner: UNASSIGNED

## Purpose

This document records the first CLI implementation contract.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- CLI command contract: `docs/cli/command-contract.md`
- CLI configuration: `docs/cli/configuration.md`
- CLI output and exit codes: `docs/cli/output-and-exit-codes.md`

## Decision

The first CLI package is `@0disoft/universal-config-engine-cli` with binary name `uce`.

The first commands are:

- `uce explain --config <pipeline.json>`
- `uce validate --config <pipeline.json>`

Both commands execute the same local resolution pipeline. The CLI does not own merge,
mapping, coercion, validation, redaction, or source-loading semantics. It calls
`@0disoft/universal-config-engine-core` and `@0disoft/universal-config-engine-node`.

Pipeline declaration files are JSON. The declaration may include:

- object sources;
- JSON file sources;
- simple dotenv file sources;
- process env sources with declared mappings;
- argv sources with declared mappings;
- Ajv JSON Schema validators;
- coercion rules;
- resource limits.

JSON file and dotenv file source paths are bounded by the pipeline declaration
directory. Relative paths resolve from that directory, and absolute paths are
accepted only when they remain inside that directory. ADR 0008 owns the path
boundary details.

Override mapping `targetPath` declarations and coercion rule `path` declarations are
write paths and therefore accept only non-empty arrays of string path segments in
the initial CLI contract. Numeric path segments may appear in diagnostic paths, but
array element writes are deferred until a dedicated merge policy exists. A mapping
with `secret: true` contributes its target path to source redaction metadata.

The CLI validates the declaration shape before source loading. Unsupported source
kinds, unknown declaration fields, missing or duplicate source ids, missing file
paths, malformed redaction policies, malformed override mappings, malformed
coercion rules, malformed validator declarations, duplicate validator ids,
source/validator id namespace collisions, malformed resource limits, and malformed
file size policies are source-loading failures. The CLI must not silently ignore
unknown source kinds or unknown declaration fields.

After declaration validation succeeds, the CLI rebuilds a typed declaration object
from the validated JSON fields instead of passing the parsed JSON object through by
type assertion. Runtime code should consume only that normalized declaration shape.

The declaration file is limited to 1 MiB before JSON parsing. An oversized
declaration produces `resource-limit/max_file_bytes_exceeded` and exit code `3`.

CLI argv source values must appear after `--`, so CLI options do not get mixed with
configuration override arguments.

JSON output carries diagnostic report schema version `0.1` plus the command name.

When a known command requests JSON output but fails CLI usage validation, the CLI
emits a versioned JSON diagnostic report on stdout and exits `4`. Unknown commands
cannot be attributed to a command-specific report, so they write usage errors to
stderr and exit `4`.

The first CLI validator declaration kind is `json-schema-ajv`. It accepts an inline
JSON Schema object or boolean schema and runs through
`@0disoft/universal-config-engine-validator-ajv`. The CLI does not dynamically import
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
- CLI file source paths can escape the pipeline declaration directory without a
  later ADR.
- Runtime execution consumes the unnormalized parsed JSON declaration object.
- JSON output omits schema version.
- Output includes raw secret values.
