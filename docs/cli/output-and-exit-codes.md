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

Redacted JSON is secret-safe, not public-safe. It may still reveal source ids, env var
names, file paths, config paths, internal host labels, or service names. Documentation
and issue templates must tell users not to paste real reports publicly without review.

CLI JSON output must include a report schema version before it is treated as stable.
Schema field changes are compatibility changes for CI and agent users.
The first schema version is `0.1`.

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
- `resolvedPaths`: paths with winning source, overridden sources, and redaction
  status.
- `provenance`: bounded event list for definition, override, default, coercion,
  validation, and redaction.
- `issues`: source-aware failures and warnings.
- `limits`: resource limits applied during the run.

Validation adapter issues use category `validation` and exit code `1`. Source
loading, mapping, merge, coercion, and resource-limit failures are reported before
validator execution and keep their more specific exit codes.

## Review Blockers

- A command emits different JSON without a contract update.
- A new failure category reuses an unrelated exit code.
- Output includes raw secret values.
- Human output cannot identify which source caused a failure.
- JSON output lacks a schema version after JSON reporting is implemented.
