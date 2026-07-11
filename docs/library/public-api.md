# Public API

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Public API Areas

- `ConfigSource`: source identity, priority, loader, and redaction metadata.
- `ConfigLoader`: adapter interface that owns source metadata and returns normalized
  config data, value locations, and source issues.
- `ConfigPipeline`: ordered execution of load, override, merge, coerce, validate,
  and report steps.
- `runConfigPipeline`: high-level facade that loads sources, resolves config, skips
  validation after resolution failure, runs validators, bounds combined issues, and
  returns both `ConfigResult` and `DiagnosticReport`.
- `OverrideMapping`: explicit env var or CLI flag mapping into config paths.
- `MergePolicy`: deterministic object merge and conflict handling.
- `CoercionPolicy`: opt-in type conversion rules.
- `ValidatorAdapter`: validation boundary for consumer-selected validators.
- `ValidatorIssue`: structured validator output containing a stable code, severity,
  and optional normalized config path.
- `ConfigProvenance`: value-level source, override, default, coercion, validation,
  and redaction report.
- `RedactedDiagnostic`: secret-safe errors and explain output.
- `ResourceLimitPolicy`: bounds for file size, object depth, key count, path length,
  diagnostics count, and source size.
- `ConfigIssue`: bounded issue taxonomy for CLI usage, load, parse, mapping,
  merge, coercion, validation, redaction, and resource-limit failures.

## Package Boundary Direction

Published package ownership is layered:

- `@0disoft/universal-config-engine-core`: pure config values, paths, sources, merge,
  provenance, diagnostics, redaction, result, loader orchestration, and adapter
  interfaces.
- `@0disoft/universal-config-engine-node`: file-system, process env, argv, JSON
  file, and simple `.env` source helpers.
- `@0disoft/universal-config-engine-cli`: command parsing and presentation only.
- `@0disoft/universal-config-engine-validator-zod`: optional Zod validator integration.
- `@0disoft/universal-config-engine-validator-ajv`: optional Ajv JSON Schema validator
  integration.
- Validator adapter packages keep validator libraries outside core.
- Repository fixtures own shared behavior cases and golden reports.

The core package must not depend on parser libraries, validator libraries, Node.js
file-system APIs, process env, argv parsing, or CLI presentation libraries.

`loadConfigSources` accepts an optional partial `ResourceLimitPolicy`. Its
`maxDiagnostics` value defaults to 200 and bounds both each retained
`LoadedSource.issues` array and the aggregate loader issues. When more issues exist,
the final retained entry is `resource-limit/max_diagnostics_exceeded` rather than
an unbounded tail. `runConfigPipeline` forwards its limits into this loading stage.

Loader results are runtime-checked before becoming `LoadedSource` objects. Invalid
issue arrays, issue entries, location arrays, or location entries reject that source
with `source-load/invalid_loader_result`. Valid loader issue and location entries
are copied, and their `sourceId` is set from the loader descriptor so an adapter
cannot attribute its output to another source.
Exceptions raised while core inspects the returned source value are represented as
`parse/source_value_inspection_failed`; raw exception text is omitted and the source
is rejected before merge.

Direct library resource-limit options are runtime-normalized as well as typed.
Only positive safe integers are accepted. Missing or invalid values such as zero,
negative numbers, `NaN`, `Infinity`, or unsafe integers fall back to the documented
default instead of disabling the bound. The CLI declaration layer remains stricter:
an explicitly malformed limit is a declaration error rather than a fallback.

Node JSON and dotenv loaders accept `FileReadPolicy.allowedRootPath`. When set,
they verify the canonical path and opened file identity before reading from the
handle; see ADR 0012.

The Node package exports `readTextFileWithinLimit` for bounded consumers such as
the CLI pipeline declaration loader. It reads through an open handle and returns a
resource-limit issue instead of allocating beyond the configured byte limit.

The Node process-env and argv helpers default to 4096 entries and export
`DEFAULT_MAX_ENV_ENTRIES` and `DEFAULT_MAX_ARGV_ENTRIES`. Callers may select a
per-source `maxEnvEntries` or `maxArgvEntries`; oversized inputs return an empty
source value plus a `resource-limit` issue before mapping.
The Node file, process-env, and argv helpers apply the same positive-safe-integer
normalization to direct JavaScript calls, so malformed numeric options cannot turn
their default bounds into unbounded comparisons.

The committed `docs/library/public-api.snapshot.txt` records normalized declaration
files for every publishable package. `pnpm run check:api-snapshot` fails when the
built declaration surface drifts. Intentional API changes require semver and
migration review before running `pnpm run update:api-snapshot`.

## Public API Principles

- Do not expose parser-specific raw shapes as core output.
- Do not require one schema validator library.
- Do not silently coerce values.
- Do not print or serialize secret values through diagnostic helpers.
- Preserve source identity for source-load, parse, merge, override, validation, and
  redaction failures.
- Keep `runConfigPipeline` thin: it orchestrates existing public stages and does not
  introduce a second merge, validation, or redaction implementation.
- Report CLI usage errors as `usage` issues when JSON output is requested for a
  known command.
- Normalize loader exceptions into `source-load` issues instead of throwing raw
  adapter failures through the pipeline.
- Do not copy loader, parser, filesystem, or internal mutation exception text into
  public issues. Use stable codes and fixed messages at each boundary.
- Distinguish JSON file access failures as `source-load/json_read_failed` from
  malformed JSON as `parse/json_parse_failed`.
- Normalize malformed validator adapter results and malformed validator issues into
  `validation` issues instead of allowing broken adapter output to corrupt
  diagnostic reports.
- Do not copy thrown validator exception text or validator-provided message,
  details, category, or source identity into diagnostics. Core reconstructs public
  validation issues from `code`, `severity`, and optional `path`; see ADR 0011.
- Accept validator issue codes only as bounded ASCII machine identifiers;
  reject prose-like or assignment-like codes as malformed adapter output.
- Normalize inconsistent validator status. A validator that returns `ok: false`
  without error issues produces a validation error issue, and any returned error
  issue makes the validator provenance status `error`.
- Treat `ValidatorResult.value` as adapter-local typed output. Core validation does
  not replace the resolved config with validator-returned values or pass those
  values to later validators; see ADR 0009.
- Isolate validator inputs from the resolved config. Validators must not be able to
  mutate the pipeline output or affect later validators by modifying `input.config`.
- Bound validator issues with the same diagnostics limit used by merge/source
  reporting. When validator output exceeds `maxDiagnostics`, emit
  `resource-limit/max_diagnostics_exceeded` instead of unbounded validation output.
- Treat the overflow marker as one of the bounded diagnostics. Every core stage
  returns at most `maxDiagnostics` issues, including the marker.
- Generate provenance during resolution rather than reconstructing it from the final
  object.
- Reject unsafe keys in public path setters and deep merge before they can mutate
  object state or object prototypes.
- Return bounded issues for resource-limit failures.
- Keep raw secret values out of diagnostic report structures, snapshots, thrown
  errors, CLI JSON, issue messages, issue details, and provenance messages.
- Treat declared `secretPaths` as subtree roots. A path such as `["database"]`
  redacts diagnostics for `["database"]` and every descendant path below it.
- Treat user-provided secret-name patterns as bounded diagnostic matchers. Reuse
  compiled matchers within a report and fall back to literal matching for invalid,
  oversized, or risky regular expressions.

## Decision State

- Expected config and adapter failures use domain-specific result objects and
  `ConfigIssue`; strict parsers and low-level invariant helpers may throw. See ADR
  0010.
- TypeScript ESM, Node.js `>=24`, package ownership, validator packages, report
  schema `0.1`, adapter ownership, and validator typed output are decided in ADRs
  0003, 0004, 0006, and 0009.
