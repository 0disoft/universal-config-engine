# Command Contract

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Library API: `docs/library/public-api.md`
- Technical owner: UNASSIGNED
- Related ADR: UNDECIDED

## Candidate Commands

### `explain`

Explain how a config resolves without printing secret values.

Candidate responsibilities:

- read declared source list;
- show source priority;
- show overridden config paths;
- show coercion decisions;
- show provenance for final values;
- emit redacted text and versioned JSON reports.

### `validate`

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
- `3`: merge, override, or coercion policy failed.
- `4`: CLI usage error.
- `5`: redaction policy failure.

## Output Rules

- Human output may name source files, config paths, and redaction reasons.
- JSON output must be stable enough for CI and agent usage.
- Neither output mode may include raw secret values by default.
- Redacted output may still contain sensitive source names, env var names, config
  paths, file paths, and internal service labels. It is secret-safe, not public-safe.
- JSON output must carry a report schema version before it is treated as stable.
- `explain` and `validate` must call the same library pipeline. CLI-specific merge or
  validation behavior is not allowed.
- Full resolved config output requires an explicit future decision and must still honor
  redaction metadata.
- A raw secret display flag is out of MVP scope and requires an ADR.

## Open Decisions

- Exact command names: draft only.
- Config file used to declare the pipeline: UNDECIDED.
- Runtime compatibility floor: UNDECIDED.
- JSON report schema version and field contract: UNDECIDED.
