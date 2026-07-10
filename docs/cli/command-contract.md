# Command Contract

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Library API: `docs/library/public-api.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## Commands

### `uce explain --config <pipeline.json>`

Explain how a config resolves without printing secret values.

Candidate responsibilities:

- read declared source list;
- show source priority;
- show overridden config paths;
- show coercion decisions;
- show provenance for final values;
- emit redacted text and versioned JSON reports.

### `uce validate --config <pipeline.json>`

Run configured validation adapters against normalized config input.

Candidate responsibilities:

- load sources through the same pipeline as `explain`;
- run validator adapters;
- report source-aware error paths;
- emit redacted text and JSON reports.

## Exit-Code Taxonomy

- `0`: success.
- `1`: validation failed.
- `2`: source loading or parser adapter failed.
- `3`: merge, override, coercion, mapping, or resource-limit policy failed.
- `4`: CLI usage error.
- `5`: redaction policy failure.

## Output Rules

- Human output may name source files, config paths, and redaction reasons.
- JSON output must be stable enough for CI and agent usage.
- Neither output mode may include raw secret values by default.
- Redacted output may still contain sensitive source names, env var names, config
  paths, file paths, and internal service labels. It is secret-safe, not public-safe.
- JSON output must carry a report schema version before it is treated as stable.
- When a known command requests JSON output but has a CLI usage error, the CLI
  emits a versioned JSON error report on stdout and exits `4`.
- When the command itself is unknown, the CLI reports the usage error on stderr and
  exits `4`.
- `explain` and `validate` must call the same library pipeline. CLI-specific merge or
  validation behavior is not allowed.
- Full resolved config output requires an explicit future decision and must still honor
  redaction metadata.
- A raw secret display flag is out of MVP scope and requires an ADR.

## Current Decisions

- Exact command names: `explain`, `validate`.
- Binary name: `uce`.
- Config file used to declare the pipeline: JSON.
- Runtime compatibility floor: Node.js `>=24`.
- JSON report schema version: `0.1`.
- CLI argv source values must appear after `--`.
- Validator declarations support first-party Ajv JSON Schema via
  `kind: "json-schema-ajv"`.

## Deferred

- Full resolved config printing is not supported in the `0.x` CLI. A future ADR
  must define redaction, output-size, and compatibility rules before adding it.
