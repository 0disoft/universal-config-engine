# Output and Exit Codes

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Command contract: `docs/cli/command-contract.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## Output Contract

Human output should explain the resolution path in a compact form:

- sources loaded;
- source priority;
- overridden config paths;
- validation status;
- redaction summary;
- failure category and source identity.

JSON output should be stable enough for CI and agent usage. It may include paths,
source names, diagnostics, and redaction reasons. It must not include raw secret
values by default.

Pipeline parser errors, validator compiler errors, and unknown option values must
not echo raw exception or user-controlled text into JSON output.

Human output escapes line breaks and C0/C1 terminal control characters in every
dynamic source, path, redaction, and issue field. Untrusted metadata must remain on
one rendered line and must not emit terminal control sequences.

Secret redaction applies to resolved path metadata, validation/source issues, and
provenance messages. If an issue or provenance event is associated with a secret
path or secret source, human-readable message text and issue details are replaced
with redacted diagnostic text before JSON output is produced.

Redacted JSON is secret-safe, not public-safe. It may still reveal source ids, env var
names, file paths, config paths, internal host labels, or service names. Documentation
and issue templates must tell users not to paste real reports publicly without review.

CLI JSON output must include a report schema version before it is treated as stable.
Schema field changes are compatibility changes for CI and agent users.
The current schema version is `0.2`. It adds optional winning and overridden source
locations to resolved paths.
ADR 0016 freezes schema `0.2`, the command envelope, and exit codes `0` through `5`
for the `1.x` line.

## Exit Codes

- `0`: success.
- `1`: validation failed.
- `2`: source loading or parser adapter failed.
- `3`: merge, override, coercion, mapping, or resource-limit policy failed.
- `4`: CLI usage error.
- `5`: redaction policy failure.

## Candidate Report Fields

- `schemaVersion`: report schema version.
- `command`: command that produced the report.
- `sources`: loaded source descriptors and load status.
- `resolvedPaths`: paths with winning source, overridden sources, redaction status,
  and optional source file, line, and column locations.
- `provenance`: bounded event list for definition, override, default, coercion,
  validation, and redaction.
- `issues`: source-aware failures and warnings.
- `limits`: resource limits applied during the run.

Human `explain` output includes `at=` and `overriddenAt=` location summaries when
available, followed by the bounded provenance event list. CLI file locations are
relative to the pipeline declaration directory and use `/` separators.

If the redacted compact report exceeds `limits.maxReportBytes`, the report is
replaced with a fixed error report containing
`resource-limit/max_report_bytes_exceeded`. The CLI never emits a cut-off JSON
document.

Validation adapter issues use category `validation` and exit code `1`. Source
loading, mapping, merge, coercion, and resource-limit failures are reported before
validator execution and keep their more specific exit codes.

CLI file source path boundary failures use category `source-load` and exit code
`2`. They happen before the file is read or parsed.

JSON file access failures use `source-load/json_read_failed`; malformed JSON after
a successful read uses `parse/json_parse_failed`. Both use exit code `2`.

When declared validator output exceeds `limits.maxDiagnostics`, the report includes
`resource-limit/max_diagnostics_exceeded`; that bounded-output failure uses the
policy failure exit code `3`. The overflow marker counts toward `maxDiagnostics`, so
the report never emits more issues than the declared limit.
Validator setup failures use the same core bounded combiner, so compiler and runtime
validator issues share one declared budget rather than being concatenated afterward.

Malformed pipeline declaration diagnostics use a separate bootstrap cap of 200.
This cap applies before a declaration is trusted and includes its overflow marker.

An oversized pipeline declaration is rejected before JSON parsing with
`resource-limit/max_file_bytes_exceeded` and exit code `3`.

CLI usage errors use category `usage` and exit code `4` when the command is known
and JSON output was requested. Unknown commands still write the usage error to
stderr because no command-specific JSON report can be attributed safely.

## JSON Golden Coverage

Executable CLI fixtures currently lock these report shapes:

- `local-precedence`: successful `explain` with JSON-file defaults, process env
  overrides, argv overrides, provenance, and secret-path redaction.
- `coercion-validation`: successful `validate` with opt-in coercion and declared
  Ajv JSON Schema validation.
- `validation-failure`: validator failure with exit code `1`.
- `secret-validation-failure`: validator failure on a redacted secret path without
  raw secret values in JSON output.
- `source-load-failure`: declaration/source-load failure with exit code `2`.
- `mapping-failure`: mapping policy failure with exit code `3`.
- `usage-error`: known-command JSON usage error with exit code `4`.

## Review Blockers

- A command emits different JSON without a contract update.
- A new failure category reuses an unrelated exit code.
- Output includes raw secret values.
- Human output cannot identify which source caused a failure.
- JSON output lacks a schema version after JSON reporting is implemented.
