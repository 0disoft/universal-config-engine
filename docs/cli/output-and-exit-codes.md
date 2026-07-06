# Output and Exit Codes

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Command contract: `docs/cli/command-contract.md`
- Technical owner: UNASSIGNED
- Related ADR: UNDECIDED

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

## Exit Codes

- `0`: success.
- `1`: validation failed.
- `2`: source loading or parser adapter failed.
- `3`: merge, override, or coercion policy failed.
- `4`: CLI usage error.
- `5`: redaction policy failure.

## Review Blockers

- A command emits different JSON without a contract update.
- A new failure category reuses an unrelated exit code.
- Output includes raw secret values.
- Human output cannot identify which source caused a failure.
