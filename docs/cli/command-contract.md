# Command Contract

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Library API: `docs/library/public-api.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## Commands

Unreleased `uce --help` / `-h`, `uce help [command]` and `uce <command> --help`
show command guidance without reading configuration. `uce --version` / `-v`
reports the installed package version. These standalone forms exit 0.

Diagnostic report byte-budget failures return exit code `3`, including ordinary
`explain` and `validate` output when config resolution itself succeeded.

Unreleased local onboarding adds `uce init` and `uce doctor` (ADR 0018), with
separate opt-in envelopes; see [onboarding](onboarding.md). Profile/workspace
selection is documented in [profiles and inheritance](profiles-and-inheritance.md).

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

## Opt-in Workspace Discovery (ADR 0018, Unreleased)

`uce explain --discover <workspace>` and `uce validate --discover <workspace>`
select a nearby JSON pipeline declaration within the explicit workspace. This
replaces `--config` for that invocation; the two options are mutually exclusive.
The Node discovery API owns ordered filenames and directory budgets, and the
opened declaration is checked against the same root. Diff retains explicit
before/after paths. Legacy synchronous argument parsing and missing-path behavior
remain unchanged. See [the discovery contract](discovery.md).

## Opt-in Inspection

Unreleased diff `--compare values,sources,locations` selects one or more comparison
dimensions. For CI use a policy's `comparison` object; `--compare` with `--policy`
is rejected. See [operational policies](../library/operational-policies.md).

### Opt-in inspection (ADR 0017)

`uce explain --config pipeline.json --values [--json]` displays safe scalar values,
source history and redaction markers using `inspection-1`. Containers are markers,
never raw serialized config. `--path '["clients",0,"name"]'` implies `--values` and
selects a typed path; `[]` selects root. JSON array paths support keys containing
dots, slashes and empty strings. The CLI accepts at most 256 path segments; the
pipeline's configured path limit also applies. Raw path JSON is bounded to 16 KiB
before parsing. A missing/unsafe path exits `4`.
Declared validators run before opt-in inspection; validation failure emits no
values. Legacy `explain` and `validate` output is unchanged. Usage errors still
use the existing `0.2` error envelope when `--json` is requested.

## Comparison (ADR 0017)

`uce diff --config before.json --against after.json [--json]` resolves and validates
both declarations sequentially. Both declarations receive the same runtime env
and argv after `--`; this is not an archived process-environment comparison.
`--path '["server","port"]'` narrows the comparison. JSON uses `diff-1` and human
output includes before/after previews, source ids and change kinds. Exit `0`
means comparison succeeded, including when changes exist. Failed input retains
the existing failure exit categories; entry/byte overflow exits `3`.
`--detect-secret-changes` opts into disclosure of secret-change metadata. It never
prints secret values or fingerprints. Without it, secret paths are explicitly
listed as uncompared. Policies can turn a successful comparison into a CI failure.

## CI Change Policies

`uce diff --config before.json --against after.json --policy policy.json [--json]`
uses `change-check-1` and runs whole-config policy evaluation. It rejects `--path`
to prevent narrowed comparisons from bypassing rules. Policy violations and
indeterminate secret comparisons exit `3`; malformed policy schema exits `4`.
Policy-file read/JSON errors exit `2`; policy-file overflow exits `3`. Source and
validation failures retain their ordinary categories. Policy JSON is bounded to
1 MiB, normalized by core and never executed. See
`docs/cli/inspection-and-diff.md` for examples and schema limits.

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
- JSON report schema version: `0.2`.
- CLI argv source values must appear after `--`.
- Split options that require a value reject a following long or short option as a
  missing value. Config paths beginning with `-` can use explicit assignment
  (`--config=-file.json`) or a relative path (`--config ./-file.json`).
- Unmapped env and argv diagnostics are opt-in; strict environment checks require
  an explicit prefix namespace.
- Validator declarations support first-party Ajv JSON Schema via
  `kind: "json-schema-ajv"`.

## Deferred

- Raw unredacted config printing remains unsupported. ADR 0017 adds opt-in bounded
  safe value inspection and comparison without changing default report `0.2`.
