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
- `combineConfigIssues`: core-owned issue combination that preserves the declared
  diagnostic cap and counts `max_diagnostics_exceeded` within that cap.
- `OverrideMapping`: explicit env var or CLI flag mapping into config paths.
- `MergePolicy`: deterministic object merge and conflict handling.
- `CoercionPolicy`: opt-in type conversion rules.
- `applyCoercionRules`: immutable coercion stage that returns a cloned `config`
  together with issues and provenance; caller input is never modified.
  Numeric path segments address existing array elements, including nested arrays;
  coercion never creates sparse arrays or missing indexes. This uses an internal
  updater: the public `setConfigValueAtPath` retains its object-only, numeric-write
  rejection contract. JSON coercion rejects `__proto__`, `constructor`, and
  `prototype` at any depth with `coercion/unsafe_key` before assignment, leaving the
  original string intact and omitting raw input from the diagnostic.
- `ValidatorAdapter`: validation boundary for consumer-selected validators.
  Validator config is a deeply frozen private clone. Freezing is iterative, so
  configurations accepted with large explicit depth limits also reach validators
  without stack overflow; caller and resolved config objects remain unfrozen.
- `ValidatorIssue`: structured validator output containing a stable code, severity,
  and optional normalized config path.
- `ConfigProvenance`: value-level source, override, default, coercion, validation,
  and redaction report.
- `RedactedDiagnostic`: secret-safe errors and explain output.
- `ResourceLimitPolicy`: bounds for source count, source size, object depth, key
  count, path length, diagnostics, provenance, resolved paths, and report bytes.
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
Normalization copies at most `maxDiagnostics` issue records, paths and detail
objects per source. All remaining raw issues and locations are still runtime
validated: a malformed tail rejects the source even when it cannot be retained.
Validation remains linear in adapter output size; excess diagnostics do not cause
unbounded additional copies before the cap is applied.

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

Aggregate defaults are 64 sources, 20,000 retained provenance events, 10,000
retained resolved paths, and 4 MiB of compact UTF-8 diagnostic-report JSON. Source
count is rejected before resolution, provenance is bounded while events are
created, and resolved paths are capped only after merge decisions complete. Reports
that exceed `maxReportBytes` are replaced by a fixed error report rather than
returning partial JSON. See ADR 0013.

`resolveConfig` checks source values early and rechecks the final config after merge
and coercion. A final aggregate or coercion-expanded structure that exceeds depth,
key-count, or path-length limits returns a `resource-limit` issue with source id
`core:resolved-config` and cannot produce `ok: true`.
Depth and path-length limits apply to scalar and null leaves as well as objects
and arrays. The root has depth zero; each property or array index adds one level
and one path segment. Values exactly at the limit remain valid.

`flattenConfigObject` emits an array as one atomic entry only after all its elements
pass validation, including nested objects and arrays. Invalid or incompletely
validated arrays are omitted from `entries`. Validation stops when the diagnostic
budget is exhausted; skipped input is signaled by `max_diagnostics_exceeded` within
that budget. Source validation errors reject the source before merge even when
loader warnings have already filled the retained issue budget.

`isConfigValue` checks JSON-compatible scalars, dense arrays and plain objects.
It returns false for cycles and array holes, accepts shared acyclic references,
and uses iterative traversal so deeply nested valid input does not overflow the
call stack. This type guard does not apply resource-limit or unsafe-key policy;
use the resolution/flattening stage for those checks.

After successful coercion, `resolvedPaths` is projected onto the final flattened
config. JSON strings expanded into objects report their new leaf paths instead of
the obsolete string path. Each new path inherits its originating source, priority,
override history, and source locations; locations identify the original encoded
value, not fabricated positions inside that string. Empty objects and arrays keep
their existing atomic path representation. Coercion provenance remains a separate
event, and the resolved-path cap applies after expansion even when the retained
provenance budget is already full.

`createMappedOverrideSource` rejects active mappings whose target paths are equal or
have an ancestor/descendant relationship. Exact duplicates use
`duplicate_mapping_target_path`; prefix collisions use
`overlapping_mapping_target_path`. The source is rejected during resolution instead
of applying an order-dependent partial value.
Only own properties of the supplied value dictionary activate mappings. Inherited
properties and getters are ignored, including names present on `Object.prototype`.
Explicitly supplied external names such as `constructor` and `__proto__` can map to
safe target paths; the existing unsafe-target-path policy still applies.

JSON mapping and JSON coercion share value checks: every numeric value, including
values nested in arrays or objects, must be finite. Syntax and non-config-value
failures use `mapping/mapping_parse_failed` or `coercion/coercion_failed` for their
respective stage. Unsafe object keys at any depth use `unsafe_key` in that stage
before assignment; failed mappings do not create partial target objects. Raw JSON
and parser exception text are omitted from these issues. JSON strings containing
numeric text remain strings; finite values at the JavaScript numeric boundary are
accepted.

JSON value checks, structural validation and `cloneConfigValue` traverse containers
iteratively. Valid deep JSON is not mislabeled as invalid syntax because a JSON
reviver or value copy exhausts the call stack. Mapping and standalone coercion do
not impose a separate depth policy: `resolveConfig` applies its configured
depth/path/key limits to the
staged source or expanded config and returns `resource-limit` issues. Native JSON
parsing still allocates the decoded value before those structural checks; bound
raw input bytes at the source adapter boundary.
Cloning preserves array holes, creates null-prototype object copies, and copies
shared acyclic children independently. Unsafe keys and cycles remain strict-helper
errors; cloning is not a substitute for source validation.
Structural traversal reuses its current path, copying it only for retained entries
and diagnostics. Large explicit depth/path limits therefore do not require a
separate copied path at every active level. The resolved-path index also visits
and prunes deep paths iteratively, including when a later source replaces them.

Source descriptor ids are resolution identities and must be unique. A duplicate id
returns `source-load/duplicate_source_id` before any source value or source issue is
merged, preventing ambiguous provenance and redaction-policy lookup.

Node JSON and dotenv loaders accept `FileReadPolicy.allowedRootPath`. When set,
they verify the canonical path and opened file identity before reading from the
handle; see ADR 0012.
JSON source syntax is checked by native `JSON.parse`; location collection then
scans tokens iteratively and omits array descendants. Deep arrays do not fail
loading merely because position collection exhausts a recursive visitor. They
reach resolution's configured structural limits, with container positions and
one-based line/column coordinates preserved.
`loadJsonFileSource` accepts `maxLocationBytes` (default 4 MiB), independent of
`maxFileBytes`. This bounds the sum of compact UTF-8 JSON bytes of retained
location records, excluding the surrounding array delimiters and commas. Duplicate
paths replace their previous record in the budget. Invalid limits fall back to the
default using the same positive-safe-integer rule as other Node limits.
When collection would exceed the budget, it stops and omits all locations, adding
one `resource-limit/max_location_bytes_exceeded` warning. Parsed config values
remain available and the warning alone does not fail resolution. Omission avoids
attaching stale coordinates to duplicate keys appearing after the stopping point;
callers requiring all positions can explicitly increase the budget.

The Node package exports `readTextFileWithinLimit` for bounded consumers such as
the CLI pipeline declaration loader. It reads through an open handle and returns a
resource-limit issue instead of allocating beyond the configured byte limit. A
successful result includes `canonicalPath`, verified against the opened file
identity with bigint inode and, when available, device identifiers before reading.

The CLI package exports `loadPipelineDeclarationContext` for callers that need the
normalized declaration together with its opened canonical path. The existing
`loadPipelineDeclaration` API remains a declaration-only compatibility wrapper.

The Node process-env and argv helpers default to 4096 entries and export
`DEFAULT_MAX_ENV_ENTRIES` and `DEFAULT_MAX_ARGV_ENTRIES`. Callers may select a
per-source `maxEnvEntries` or `maxArgvEntries`; oversized inputs return an empty
source value plus a `resource-limit` issue before mapping.
The Node file, process-env, and argv helpers apply the same positive-safe-integer
normalization to direct JavaScript calls, so malformed numeric options cannot turn
their default bounds into unbounded comparisons.

The Node override helpers accept optional `unmappedBehavior` values `warning` and
`error`. Process-env checks require `unmappedPrefix` and inspect only that namespace;
argv diagnostics expose indexes rather than raw unknown argument text. Missing
policy preserves silent ignore behavior. See ADR 0015.

Recognized split argv mappings consume their value exactly once; consumed values
are never reinterpreted as another mapping or assignment. Unmapped tokens are
reported individually because unknown options have no declared value arity.
Declared argv names match literally in both split and `name=value` forms, including
non-BMP Unicode characters such as emoji.
Node env mappings likewise read only own input properties. The env/argv staging
dictionaries and dotenv parser preserve literal external names such as `__proto__`
without invoking prototype setters, allowing explicit mapping to safe config paths.
Simple dotenv parsing strips matching quotes only when both opening and closing
characters are present; a lone quote remains a literal one-character value.

The committed `docs/library/public-api.snapshot.txt` records normalized declaration
files for every publishable package. `pnpm run check:api-snapshot` fails when the
built declaration surface drifts. Intentional API changes require semver and
migration review before running `pnpm run update:api-snapshot`.
`docs/library/public-api-stability.md` classifies the `v0.5.0` declarations for the
`1.0` audit without changing their current public status.

## Public API Principles

- Do not expose parser-specific raw shapes as core output.
- Do not require one schema validator library.
- Do not silently coerce values.
- Do not mutate public coercion inputs. Pipeline orchestration must explicitly adopt
  the returned coerced config.
- Do not print or serialize secret values through diagnostic helpers.
- Preserve source identity for source-load, parse, merge, override, validation, and
  redaction failures.
- Keep `runConfigPipeline` thin: it orchestrates existing public stages and does not
  introduce a second merge, validation, or redaction implementation.
- Use `combineConfigIssues` at orchestration boundaries instead of concatenating
  independently bounded issue arrays.
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
- Accept only strings and non-negative safe integers as loader issue, source
  location and validator issue path segments; reject sparse paths and invalid
  numeric indexes as malformed adapter output.
- Do not copy thrown validator exception text or validator-provided message,
  details, category, or source identity into diagnostics. Core reconstructs public
  validation issues from `code`, `severity`, and optional `path`; see ADR 0011.
- Accept validator issue codes only as bounded ASCII machine identifiers;
  reject prose-like or assignment-like codes as malformed adapter output.
- Resolve Ajv JSON Pointer numeric segments against the validated config shape.
  An empty pointer identifies the root; `/` identifies an empty property name
  and is preserved as `[""]`, including in nested validation and redaction paths.
- Append the literal `missingProperty` or `additionalProperty` name for Ajv
  `required` and `additionalProperties` issues so redaction evaluates the affected
  property. Numeric-looking property names remain strings; names containing `/`
  or `~` are not decoded a second time.
- Preserve standard Ajv keyword codes; use `ajv_custom_keyword` for keywords outside
  the bounded core code grammar, without retaining their names or error prose.
  `instancePathToConfigPath` preserves ambiguous numeric-looking segments as strings
  when no root value is provided.
- Normalize inconsistent validator status. A validator that returns `ok: false`
  without error issues produces a validation error issue, and any returned error
  issue makes the validator provenance status `error`.
- Treat `ValidatorResult.value` as adapter-local typed output. Core validation does
  not replace the resolved config with validator-returned values or pass those
  values to later validators; see ADR 0009.
- Isolate validator inputs from the resolved config. Validators must not be able to
  mutate the pipeline output or affect later validators by modifying `input.config`.
- Copy and deeply freeze validator provenance input, including event paths, so
  adapters cannot rewrite the provenance later consumed by reports.
- Bound validator issues with the same diagnostics limit used by merge/source
  reporting. When validator output exceeds `maxDiagnostics`, emit
  `resource-limit/max_diagnostics_exceeded` instead of unbounded validation output.
- Treat the overflow marker as one of the bounded diagnostics. Every core stage
  returns at most `maxDiagnostics` issues, including the marker.
- Generate provenance during resolution rather than reconstructing it from the final
  object.
- Preserve adapter-provided source locations on winning and overridden resolved
  paths. Node file loaders report canonical opened paths; the CLI emits
  declaration-relative paths. See ADR 0014.
- Reject unsafe keys in public path setters and deep merge before they can mutate
  object state or object prototypes.
- Return bounded issues for resource-limit failures.
- Keep raw secret values out of diagnostic report structures, snapshots, thrown
  errors, CLI JSON, issue messages, issue details, and provenance messages.
- Treat declared `secretPaths` as subtree roots. A path such as `["database"]`
  redacts diagnostics for `["database"]` and every descendant path below it.
- Apply whole-source redaction (`secretSource` or `secretSourceIds`) to diagnostics
  whose source or previous source is secret, or whose exact resolved path records
  a secret winning or overridden source. An empty or unrelated secret source does
  not mask public-path diagnostics. Explicit path/name policies still apply across
  sources. Resolved-path metadata and diagnostic messages use the same path
  redaction decision, retaining policies from overridden sources as well as the
  winning source. Source-wide policies remain limited to participating paths;
  explicit path/name policies from all sources apply even without a winning value.
- Combine source-level and report-option `secretNamePatterns` as a union. A source
  pattern array, including an empty one, never disables report-option patterns.
- Treat user-provided secret-name patterns as case-insensitive literal substrings.
  Core never compiles caller-provided patterns as regular expressions. Default API
  key detection uses explicit `api_key`, `api-key`, and `apikey` variants.

## Decision State

- Expected config and adapter failures use domain-specific result objects and
  `ConfigIssue`; strict parsers and low-level invariant helpers may throw. See ADR
  0010.
- TypeScript ESM, Node.js `>=24`, package ownership, validator packages, report
  schema `0.2`, adapter ownership, and validator typed output are decided in ADRs
  0003, 0004, 0006, and 0009. ADR 0016 fixes the `1.x` stability, deprecation,
  report, CLI, low-level helper, and runtime compatibility contracts.
