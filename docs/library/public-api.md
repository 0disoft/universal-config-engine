# Public API

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Public API Areas

- `ConfigSource`: source identity, priority, loader, and redaction metadata.
  After source-count and priority preflight, resolution owns copies of returned
  descriptors and nested redaction policy arrays, so later caller changes cannot
  alter the resolved masking policy. Source-count failures retain only bounded
  descriptor references without inspecting their fields.
  Priorities must be finite numbers. Core loading and direct resolution reject
  invalid priorities before invoking loaders, inspecting values or sorting; failure
  uses `source_priority_invalid` and omits invalid descriptor metadata.
- `ConfigLoader`: adapter interface that owns source metadata and returns normalized
  config data, value locations, and source issues.
- `ConfigPipeline`: ordered execution of load, override, merge, coerce, validate,
  and report steps.
- `runConfigPipeline`: high-level facade that loads sources, resolves config, skips
  validation after loading or resolution failure, runs validators, bounds combined
  issues, and returns both `ConfigResult` and `DiagnosticReport`.
- `combineConfigIssues`: core-owned issue combination that preserves the declared
  diagnostic cap and counts `max_diagnostics_exceeded` within that cap.
- `OverrideMapping`: explicit env var or CLI flag mapping into config paths.
  `secret: true` contributes an owned target path to source redaction metadata in
  core and Node helpers as well as CLI declarations, including absent/invalid input.
  Existing source redaction policies are preserved; unrelated source kinds do not contribute paths.
- `MergePolicy`: deterministic object merge and conflict handling.
  Empty objects contribute no fields when merged into non-empty objects; existing
  descendants, source ownership and locations remain intact. They still create a
  missing object or replace a scalar, array or null with an empty object.
- `getConfigValueAtPath`: typed lookup reads only own object fields and existing
  own array elements. Array indexes must be non-negative safe integers below the
  array length; inherited indexes and numeric metadata are not config values.
- `setConfigValueAtPath`: object-only writes validate every path segment and clone
  the replacement before changing ancestors. Invalid paths, unsafe keys and cyclic
  replacement values therefore fail without partially replacing existing config.
- `CoercionPolicy`: opt-in type conversion rules.
- `applyCoercionRules`: immutable coercion stage that returns a cloned `config`
  together with issues and provenance; caller input is never modified.
  Optional `limits` bound diagnostics at creation and share the event budget with
  optional incoming `provenance` (only new events are returned). The full
  `maxProvenanceEvents` also caps the rule count, including no-op rules; excessive
  lists fail before rule/config inspection and return an empty config. No further
  conversion runs after diagnostic overflow or when no event slot remains.
  Resolution skips coercion after merge failure. Structural depth/path policy
  remains owned by resolution, independently of these execution/retention budgets.
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
- Validation `ConfigIssue` entries identify their origin with `validatorId`.
  `sourceId` remains a legacy correlation field; validator errors do not mark an
  input source with the same ID as failed or inherit its source-only secret policy.
  Path-based secret policies still apply to validator diagnostics.
- `ConfigProvenance`: value-level source, override, default, coercion, validation,
  and redaction report.
- `RedactedDiagnostic`: secret-safe errors and explain output.
  Diagnostic reports own their paths, issue details, source locations, provenance
  and limits metadata; editing a report does not mutate its resolution result.
- `ResourceLimitPolicy`: bounds for source count, source size, object depth, key
  count, path length, diagnostics, provenance, resolved paths, and report bytes.
  `maxKeyCount` counts expanded object keys and array indexes, including repeated
  references. Exhaustion stops structural traversal before merge clones arrays.
  Large scalar arrays now need an explicitly larger budget just like wide objects.
- `ConfigIssue`: bounded issue taxonomy for CLI usage, load, parse, mapping,
  merge, coercion, validation, redaction, and resource-limit failures.

## Safe Value Inspection

`buildPublicDiagnosticReport(report)` projects bounded diagnostics to the separate
`public-diagnostic-1` allowlist, replacing source/path identities with per-report
aliases and omitting values, names, locations, codes and prose. See
[public sharing](public-sharing.md) for retained metadata and disclosure limits.

Node `createConfigReloader` serializes explicitly requested pipeline refreshes,
coalesces queued work, owns immutable last-good snapshots and suppresses late
publication after close. Failure/event data excludes values and provider prose.
Asynchronous observers run serially with one latest pending notification, and
receive an optional second operation-options argument for cooperative cancellation.
See [reload lifecycle](../adapters/reload.md); snapshots themselves contain secrets.

`buildConfigInspection(result, options?)` is the opt-in `inspection-1` value
surface (ADR 0017). `options.path` uses typed `ConfigPath` segments. Entries contain
scalar previews (default 1024 UTF-16 code units), container markers, redaction and
closest-source metadata. Arrays are expanded without serializing raw containers.
Secret containers are opaque. A direct query inside an atomic secret array stays
redacted. Failed resolutions expose no values. Missing/unsafe queries and entry or
byte overflow return error reports with no entries. Inspection counts containers
against `maxResolvedPaths`, so a result near its leaf limit can exceed this budget.
Filtered sanitized diagnostics retain ancestors and descendants of the query;
root validation events remain available. This is an explanation of recorded
decisions, not a historical store of overwritten values. Metadata is not public-safe.

## Config Comparison

`buildConfigDiff(before, after, options?)` returns opt-in `diff-1` output. Both
arguments must be resolved results. It compares complete values, not truncated
inspection previews, and emits `added`, `removed`, `type-changed`, `value-changed`
and `source-changed` kinds. Container children are independent entries. Source
identity includes winning priority, override history and retained source locations.
Location fields compare by value, independently of object property insertion order;
the order of overridden locations remains significant.
Opaque secret objects also compare descendant ownership in memory without adding
their children or ownership fingerprints to displayed entries.
Entries are deterministically sorted by serialized typed path. Both sides' secret
policies apply to both outputs; metadata remains visible. Secrets are explicitly
uncompared by default. `detectSecretChanges: true` compares opaque secret values
in memory without retaining values, hashes or fingerprints. A missing selected
path on just one side is an addition/removal; missing on both sides is an error.
Failed input, combined entry overflow and combined JSON byte overflow discard
value-bearing entries and changes. Fixed error envelopes may exceed impractically
small byte limits. Neither inspection nor comparison stores historical raw values.

## CI Change Policies

`checkConfigChanges(before, after, policy, options?)` returns `change-check-1`
containing a whole-config `diff-1` and structured policy violations. Policy schema
`change-policy-1` supports `forbid-changes`, `require-path` and `allowed-sources`
rules. Malformed policies and incomplete comparisons fail closed. Secret-value
uncertainty cannot pass a forbid rule. Required-path checks use actual config,
including null and opaque secret containers, without retaining values. Policies
never narrow comparison to a query. Inputs are normalized into owned rule data;
unknown fields, unsafe paths, duplicate ids and bounded rule/path/source-id limits
are enforced at runtime. See `docs/cli/inspection-and-diff.md` for exact bounds,
semantics and examples. The combined report obeys the smaller report-byte budget.

## Ajv Execution Budget (Unreleased)

The Ajv adapter defaults to first-error execution (`allErrors: false`). Explicit
`options.allErrors` and caller-provided Ajv instances retain their chosen behavior.
`maxIssues` bounds issue conversion/retention to 200 by default, with a hard cap of
10,000 and an `ajv_issues_truncated` error occupying the last slot on overflow.
Complete-error collection remains opt-in and can allocate more errors inside Ajv;
the adapter does not impose an execution deadline or a schema-complexity sandbox.

## Standard Schema Validation (ADR 0018, Unreleased)

`createStandardSchemaValidator` accepts a structural `StandardConfigSchema` v1
provider and infers its output type without adding a core runtime dependency.
It awaits each callback once, copies representable typed paths, bounds retained
issues and omits provider prose. The adapter's typed/transformed `value` remains
separate from pipeline config under ADR 0009. See
[typed validation](typed-validation.md) for limits and failure behavior.

`runValidatedConfigPipeline` adds a separate discriminated `ok`/`value` result
using a typed `outputValidator`. It runs only after the ordinary pipeline succeeds,
shares aggregate validation budgets and returns no typed value on failure. The
original resolved config, report schema and ADR 0009 validator behavior remain
unchanged. The typed value is application data and may contain secrets.

Node `selectPipelineProfile` (also re-exported by CLI) compiles a named profile into the base declaration
without process-environment inference. It preserves ids/priorities, combines
declared stages and limits, and rejects malformed profiles or aggregate collisions.
See [profiles and inheritance](../cli/profiles-and-inheritance.md).

Node `loadConfig` / `loadValidatedConfig` own the shared app/CLI execution path;
declaration/source/profile APIs are re-exported by CLI for compatibility. Core
`validateConfigOutput` validates typed output from an existing pipeline without
reloading sources. Ajv remains an explicitly supplied optional Node factory.
See [application loading](../adapters/load-config.md) for failure and cancellation
behavior. No runtime dependencies were added to core or Node.

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
If the loader count exceeds `maxSources`, no loader or validator is invoked. The
pipeline retains `resource-limit/max_sources_exceeded` in its failed result and
error report even though no sources were loaded. Source-owned issues otherwise
flow through resolution once, without duplicating the aggregate loader issues.
Only an error-severity `resource-limit/max_diagnostics_exceeded` is an overflow
marker. An adapter warning with the same code cannot suppress the fatal marker
when later diagnostics exceed the budget, including when a discarded issue is an error.
Normalization copies at most `maxDiagnostics` issue records, paths and detail
objects per source. All remaining raw issues and locations are still runtime
validated: a malformed tail rejects the source even when it cannot be retained.
Validation remains linear in adapter output size; excess diagnostics do not cause
unbounded additional copies before the cap is applied.

Loader locations are deduplicated by typed path (last position wins), with at most
`maxResolvedPaths` unique records, `maxPathLength` segments per path, and
`maxReportBytes` total UTF-8 bytes of serialized normalized records, excluding
array delimiters and commas. Exceeding any budget drops all optional locations
and emits one `resource-limit/max_location_metadata_exceeded` warning; valid config
values remain usable. The complete raw location list is still validated, including
after overflow. Duplicate paths reuse the retained path copy. As with other
warnings, overflowing `maxDiagnostics` produces a fatal diagnostics overflow marker.

`resolveConfig` appends source and structure diagnostics directly into the bounded
issue list without first copying or concatenating the complete source issue array.
Source issues still precede structure issues. Error detection also inspects the
discarded source tail when needed, so an error beyond the retained prefix still
rejects that source; the adapter's issue array is never mutated.

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

`resolveConfig` checks `maxSources` before copying or sorting the complete source
list. On count rejection, it retains only the first `maxSources` descriptors in
declaration order for failure metadata, without reading source priorities or
values. This replaces the former globally priority-selected failure subset.
Accepted inputs still use stable priority ordering and unchanged merge semantics.

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
Coercion issues and provenance copy their rule paths when emitted. Reusing a rule's
path array during later validation or after completion cannot rewrite retained
paths or change their redaction decisions; the caller's array remains mutable.

`createMappedOverrideSource` rejects active mappings whose target paths are equal or
have an ancestor/descendant relationship. Exact duplicates use
`duplicate_mapping_target_path`; prefix collisions use
`overlapping_mapping_target_path`. The source is rejected during resolution instead
of applying an order-dependent partial value.
Only own properties of the supplied value dictionary activate mappings. Inherited
properties and getters are ignored, including names present on `Object.prototype`.
Explicitly supplied external names such as `constructor` and `__proto__` can map to
safe target paths; the existing unsafe-target-path policy still applies.
Mapping errors, including argv missing-value and duplicate-argument errors, retain
copies of their target paths. Reusing a mapping declaration's array after source
creation cannot change existing issues or their later report redaction.

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
not impose a separate depth policy. During resolution, JSON coercion checks each
candidate against absolute depth/path limits and the remaining aggregate key/index
budget before cloning or assigning it. A structural overflow stops subsequent
rules, preserving completed conversions and the original value at the failed path.
The existing tree is counted once; later checks inspect only each candidate.
`resolveConfig` returns `resource-limit` issues for structural overflow. Native JSON
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

`maxKeyCount` also bounds the combined tree during merge. Writes account for
replaced subtrees before allocation; overflow leaves a bounded partial result and
skips later source values. A later replacement cannot rescue an oversized
intermediate tree. `maxResolvedPaths` continues to cap only the public result.

Node `loadConfigFileSource` (ADR 0018, unreleased) accepts an explicit
`ConfigFileFormat`: `json`, `jsonc`, `yaml`, `toml` or `json5`. Additional parsers
remain in the Node package and load on demand. New dialects reject unsafe keys,
non-JSON values and structural overflow before returning source values; JSONC
retains bounded locations and has opt-in trailing commas. YAML aliases/custom
tags and TOML date/time objects are unsupported. The `json` branch delegates to
the existing strict loader. See [the format contract](../adapters/official-files.md).

Node `discoverPipelineDeclaration` selects the nearest existing declaration from
the frozen `DEFAULT_PIPELINE_FILENAMES` inside an explicit workspace. It defaults
to 32 directories and never exceeds 256, executes no config code and returns
bounded source-load/resource issues instead of provider exceptions. It does not
read config contents or replace opened-file root verification; see
[workspace discovery](../cli/discovery.md).

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
Dotenv parsing retains at most 200 issues by default, capped at 10,000. File
loaders accept `maxIssues`; `parseSimpleDotenv` accepts the same budget as its
optional fourth argument. On overflow the final slot contains the error
`dotenv_issues_truncated` and parsing stops; partial values are rejected by core.
Exactly filling the budget does not imply truncation. The CLI forwards its
effective `maxDiagnostics` so the parser bounds allocation before core normalization.

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
- Copy accepted validator issue paths into core-owned arrays. Reusing or mutating
  an adapter's path array in later validators or after pipeline completion cannot
  change retained diagnostic paths or their redaction decisions. The adapter's
  original path array is not frozen or modified.
- Accept only strings and non-negative safe integers as loader issue, source
  location and validator issue path segments; reject sparse paths and invalid
  numeric indexes as malformed adapter output.
- Validate legacy issue `details` consistently at loader and validator boundaries:
  values must be JSON-compatible primitives, including finite numbers. Non-finite
  details reject the adapter issue; accepted validator details remain omitted from
  public diagnostics. Both boundaries use one internal details guard.
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
- Reject Ajv `$async` schemas during adapter creation, matching the synchronous
  `Schema` input contract even for JavaScript callers. No validation Promise is
  started or mistaken for a successful result. Synchronous schemas retain their
  existing result shape and error/path normalization.
- Await Zod refinements and transforms through asynchronous schema parsing. The
  adapter returns a Promise for every schema, consistent with `ValidatorAdapter`;
  direct callers must await it. Parse each input once, retain structured failure
  codes/paths, and let rejected callbacks reach core's `validator_threw` boundary
  without retaining raw exception text. Async typed output remains adapter-local.
- Zod's optional `maxIssues` bounds converted issue records and paths, including
  one `zod_issues_truncated` error when needed. It defaults to 200 and is capped at
  10,000; invalid values use the default. This bounds adapter conversion and direct
  output, not Zod's own parsing/error collection. Configure the schema to bound
  provider work; core still independently applies the pipeline diagnostics limit.
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
- Count incoming history and new validator events against the same
  `maxProvenanceEvents` budget. `runValidators` returns only new events and skips
  subsequent validators once that shared budget is full. The pipeline passes the
  original limit rather than subtracting the history twice.
- Bound validator issues with the same diagnostics limit used by merge/source
  reporting. When validator output exceeds `maxDiagnostics`, emit
  `resource-limit/max_diagnostics_exceeded` instead of unbounded validation output.
- Treat the overflow marker as one of the bounded diagnostics. Every core stage
  returns at most `maxDiagnostics` issues, including the marker.
- Generate provenance during resolution rather than reconstructing it from the final
  object.
- Override events identify the immediately previous winning source, independently
  of the oldest-first `overriddenSourceIds` history. When a parent replacement
  overlaps several current owners, `previousSourceId` identifies the owner with
  the highest priority (first retained traversal entry for a tie). The complete
  set remains in override history; a same-source replacement omits `previousSourceId`.
- Preserve adapter-provided source locations on winning and overridden resolved
  paths. Node file loaders report canonical opened paths; the CLI emits
  declaration-relative paths. See ADR 0014.
- When one source replaces an atomic parent with several object descendants,
  every descendant inherits the displaced parent's ownership and location history,
  independently of sibling key order. The live index contains only effective paths.
- Reject unsafe keys in public path setters and deep merge before they can mutate
  object state or object prototypes.
- Return bounded issues for resource-limit failures.
- Keep raw secret values out of diagnostic report structures, snapshots, thrown
  errors, CLI JSON, issue messages, issue details, and provenance messages.
- Treat declared `secretPaths` as subtree roots. A path such as `["database"]`
  redacts diagnostics for `["database"]` and every descendant path below it.
- Apply whole-source redaction (`secretSource` or `secretSourceIds`) to diagnostics
  whose source or previous source is secret, or whose resolved path or atomic
  ancestor records a secret winning or overridden source. This includes diagnostics
  inside arrays, which retain ownership at the array path. An unrelated secret source does
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

Override location history deduplicates identical source/position tuples in first-seen order. All override-history insertions share cumulative resolution-wide `maxResolvedPaths` entry and `maxReportBytes` serialized-location budgets, including copies inherited by siblings; exhaustion stops subsequent optional history expansion and omits the overflowing history with `max_location_metadata_exceeded`, without discarding configuration values.

Generic loader and validator diagnostic paths must fit `maxPathLength` and the serialized UTF-8 `maxReportBytes` budget. Invalid or oversized paths fail closed as `invalid_loader_result` or `validator_issue_invalid`; the raw path is not retained.

If `max_resolved_paths_exceeded` leaves source ownership incomplete, diagnostic reports return only a fixed resource-limit failure, without source metadata, arbitrary diagnostics or provenance. Shared value-report redaction also fails closed for this result. Normal complete results retain path-specific redaction.

The Ajv adapter validates an owned mutable config copy when `coerceTypes`, `useDefaults` or `removeAdditional` is enabled, when custom `keywords` are supplied through options, or when the caller supplies an Ajv instance (which may have modifying keywords). Its returned `value` contains those object/array mutations; resolved config and provenance remain unchanged under ADR 0009. Default non-modifying validation avoids this extra copy.

`loadConfigSources` rejects duplicate descriptor IDs before invoking any loader, including when called through `runConfigPipeline`. Its bounded preflight returns no loaded sources on identity conflicts. `resolveConfig` shares the same duplicate-ID rule for already loaded inputs. Invalid registrations therefore perform no source I/O or downstream validation.

Node file readers reject malformed UTF-8 in the default `utf8`/`utf-8` mode rather than replacing invalid bytes with Unicode replacement characters. Decoding follows bounded byte collection, so valid multibyte characters crossing read chunks are preserved. Existing BOM handling and explicit non-UTF-8 encodings are unchanged.

Ajv root coercions are captured through the compiled validator parent-data context: successful adapter output contains the transformed scalar or array, while the input and schema reference scope remain unchanged. Failure paths use the transformed root for typed array indexes.

Argument values accept the same negative decimal forms in separate-token and assignment syntax, including trailing decimal points and exponents (`--n -1.e2` and `--n=-1.e2`). Short option tokens remain options rather than values.

## Optional cancellation

Pipeline, source loading and validation accept an optional `signal` compatible
with native `AbortSignal`. `ConfigAbortSignal` is a structural interface, so core
adds no Node or DOM declaration dependency. Loader callbacks may accept a second
optional `ConfigOperationOptions` argument; validator inputs may contain `signal`.
Existing required parameters and result shapes are unchanged. Pre-cancelled work
skips callbacks and validation cloning. Cancellation stops waiting for a pending
callback, skips later callbacks, reports sanitized `operation_aborted` and prevents
successful typed output; listeners are removed and late rejections are observed.
Callback I/O must cooperate with the signal to actually stop its external work.
Synchronous resolution and provider execution cannot be preempted by this signal.

`ConfigOperationOptions.onError?` is an opt-in private operational observer. Loader,
validator, Node file and reload boundaries send `ConfigOperationError` containing a
stable `code`, optional `sourceId`, and an `Error` whose `cause` is the original
exception. `reportConfigOperationError(options, code, cause, sourceId?)` provides
the same isolated boundary for custom adapters. Pipeline hooks reach loader options;
forward those options to nested file loaders. Hook exceptions/rejections cannot
change operation results. Hooks must finish promptly; they are never awaited.
These errors can contain secrets and are never attached to config results, public
reports or default logs. Consumers own restricted handling of private causes.
Public diagnostics retain their existing sanitized codes and messages. Signals may
expose an optional private `reason`; cancellation reasons are not serialized.

Core deliberately owns no clock or automatic retries. Callers needing a pipeline
deadline can supply a native timeout/composed signal from their runtime; forward
it through loaders to actual I/O. The Node reloader has independent configurable
30-second load/observer deadlines; see `docs/adapters/reload.md` for terminal
timeout behavior and recovery. Arbitrary callbacks are never assumed idempotent.

Node file policies accept optional `signal`, `fileSystem` and `readLimiter` fields. The filesystem
implements only `open`, `realpath`, `stat` and a bounded file handle's `stat/read/close`
operations, so tests can reproduce I/O races without global module mocks. Optional
`fileSystem.withSignal(signal)` binds a cancellation-aware implementation for the
operation without acquiring resources. Existing I/O method signatures and native
filesystem implementations remain compatible. Signals
are checked before opening and after asynchronous boundaries; native in-flight reads
must finish before their handle can be cleaned up. Cancellation uses `operation_aborted`.
Handles close once on every path, and a cleanup exception does not replace an
existing operation exception or policy failure. Successful reads still report close failures.

File reads share an admission budget of `DEFAULT_MAX_CONCURRENT_FILE_READS` (64)
per loaded Node adapter instance. Capacity includes pending open/read/close work,
even after a caller stops waiting or cancels. Excess calls fail before opening with
`resource-limit/max_concurrent_file_reads_exceeded`; they do not create a waiting queue.
An unconfirmed close failure keeps its lease reserved rather than assuming a
resource was released. `createConfigFileReadLimiter(maxConcurrent?)` creates an
explicit application-owned budget; share it across loaders through `readLimiter`.
Leases release idempotently. Invalid capacities throw `RangeError`.
Native in-flight operations still cannot be force-stopped; the budget bounds their
accumulation rather than claiming that request cancellation closes them immediately.
