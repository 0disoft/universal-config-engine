# Changelog

All notable changes to Universal Config Engine are recorded here. The project uses
semantic versioning and keeps package versions aligned across the workspace.

## Unreleased

## 1.3.0-rc.1 - 2026-10-25

### Security

- Require Zod >=4.6.6 within major 4 and validate with 4.6.7 to exclude the
  oversized-collection memory-exhaustion vulnerability GHSA-mrhx-c7xc-m3w5.
- Refresh the locked Ajv fast-uri dependency to patched 3.1.9, addressing its
  URI normalization advisories without a major dependency upgrade.

### Fixed

- Canonicalize dependency/watch/inheritance test workspaces before matching paths,
  supporting Windows runners whose temporary root uses an 8.3 directory alias.
- Reject sources with reported errors before reading or flattening their payloads.
  Avoid unnecessary accessor/traversal work and preserve original failures instead
  of overflowing the diagnostic budget with redundant payload errors.
- Bound initial watcher root/stat/path-selection I/O with cancellation and the
  existing load timeout, including automatic workspace-alias canonicalization.
  Release setup timers/listeners and prevent late I/O from installing watches or
  starting more metadata requests after the setup has ended.
- Capture atomic array values during structural admission instead of retaining live
  source references. Avoid repeated accessor reads during merge counting/cloning,
  uncaught second-read failures and changes to already validated array entries.
- Report YAML/TOML/JSON5 parse positions and fixed diagnostic reasons without
  parser prose, source snippets, tokens or key names. Retain existing error codes,
  secret-source/public-share masking, bounded parsing and private error causes.
- Add Node `watchConfig` to discover and watch declaration/inheritance/file-source
  dependencies before reads, refresh changing dependency sets, retain repair
  subscriptions on failure and release obsolete watches after success. Share the
  existing reloader/cancellation engine with fixed path, handle and I/O budgets.
- Discover declaration, inherited declaration and selected file-source dependencies
  before I/O through an awaited Node `onDependencies` hook, including missing
  inherited files needed for recovery and sanitized observer failures.
- Reuse each CI/runtime job's workspace build for checks and packed smoke while
  retaining all eight OS/Node jobs, existing check names and packaging lifecycle
  hooks. Reduce explicit whole-workspace builds per push/PR from 14 to 8.
- Rebind file watches when an intermediate directory or directory symlink is
  replaced. Watch logical and canonical ancestor components within the workspace,
  retaining the 128-handle maximum and bounding path resolution to 192 requests
  per selection pass; rejected retargets preserve the last good configuration.
- Validate parsed JSON values in one iterative pass for mappings and coercion,
  eliminating the duplicate generic object-graph traversal and its cycle-detection
  sets while preserving unsafe-key precedence and finite-number checks.
- Fetch source values only after structural admission checks. Avoid eager object
  entry allocation and prevent discarded object/array accessors from executing
  beyond key, diagnostic or depth/path limits or for rejected unsafe keys.
- Preserve both sides' secret paths during comparison when standalone diagnostics
  exceed their byte budget. Derive shared masking policy directly from resolved
  paths and the redactor, so discarded display metadata cannot expose values.
- Compile redaction policies once per inspection and share cached path decisions
  with diagnostic construction, avoiding duplicate matcher/index allocations while
  retaining per-call policy freshness and existing masking behavior.
- Bound YAML collection nesting during streaming parsing, before recursive document
  composition, and report `max_parse_depth_exceeded` instead of consuming the whole
  deeply nested input or falling back to an internal parser failure.
- Add optional strict decimal/safe-integer and empty-input mapping policies, plus
  independent value/source/location comparisons shared by diff and policy-owned CI
  checks. Preserve defaults and reject caller attempts to narrow CI comparisons.
- Add opt-in, allowlisted validator type/bound constraints for Ajv/Zod and declared
  schemas; sanitize them at core boundaries, mask secret-path metadata and keep
  provider prose/values out of diagnostics and public-share reports.
- Share application/CLI declaration execution through Node loadConfig and
  loadValidatedConfig, keeping CLI exports compatible and Ajv an optional factory.
  Reuse core typed-output validation without reloading sources and forward optional
  cancellation/private error observers across file and validator stages.
- Add standalone CLI help/version, terminal-safe per-issue doctor diagnostics and
  a non-overwriting defaults/environment/schema initialization example.
- Align stable installation documentation with the 1.2.0 baseline and distinguish
  source-checkout additions from published APIs instead of recommending an old RC.
- Apply declaration coercion rules and resource limits in the application adoption
  example, with installed CLI/application parity checks for coercion and rejection.
- Separate validator diagnostics from input source status and source-only masking
  when their IDs coincide, retaining legacy sourceId and adding validatorId.
- Extend bounded repeated-run rejection to alternating UTF-16 pairs when uniform
  runs cannot exclude a candidate, reducing overflow exact searches without new
  buffers or pattern metadata and preserving the existing span cap.
- Reject impossible repeated-unit patterns after uninformative gram filtering by
  comparing a bounded center run with the query's maximum run, avoiding repeated
  exact searches without new buffers or per-pattern metadata.
- Preview up to three literal grams before adaptive query filtering, bypassing
  its full query pass when the samples already occur; retain the 136 KiB buffer
  ceiling with at most three temporary four-unit strings per query.
- Adapt repeated overflow exact searches with four-unit query grams in the same
  filter buffer; activate after 128 searched candidates and stop probing after 32
  consecutive survivors, preserving literal decisions, source rank and memory caps.
- Reject overflow name-pattern candidates whose shared prefix and suffix pass the
  existing pair samples but whose quarter pair is absent, reducing exact searches
  without increasing filter buffers or changing literal matches and source rank.
- Reject impossible prefix matches before overflow policy scans, including diverse
  and incidental suffix hits; share the existing length filter without increasing
  the 136 KiB filter-buffer ceiling or changing literal semantics.
- Reject impossible overflow name queries with a bounded literal-suffix gate,
  avoiding per-query pattern scans and lazy buffer allocation for short paths
  while preserving the existing filter-memory ceiling and exact fallback.
- Replace overflow name-pattern window hashing with a fixed-memory query-pair
  filter, avoiding repeated length scans and collision-driven substring copies
  while preserving literal matches and source-rank precedence.
- Inherit base declaration limits during profile preflight, retaining explicit
  profile overrides, malformed-limit diagnostics and combined source checks.
- Bound Zod issue conversion with optional `maxIssues` (default 200, cap 10,000),
  preserving failure and a truncation marker without copying the complete tail.
- Enforce the combined key/index budget before merge writes, subtract replaced
  subtrees and stop further source work when the intermediate tree would overflow.
- Preflight CLI validator counts, compile only after successful resolution with
  sufficient remaining provenance, and bound compile diagnostics at generation.
- Preserve displaced parent ownership, locations and secret-source history for
  every replacement descendant, independent of sibling key order.
- Reject prototype-named CLI source kinds with a precise `unsupported_source_kind`
  diagnostic instead of an internal exception and generic declaration failure.
- Attribute override provenance to the immediately previous winner instead of the
  oldest historical source, preserving complete oldest-first override history.
- Cap file-watch debounce postponement at one second so continuous changes still
  request serialized refreshes; close cancels both pending timers.
- Deduplicate and bound normalized loader locations by path length, unique path
  count and serialized bytes; omit optional positions with a warning on overflow
  while continuing to reject malformed adapter metadata anywhere in the list.
- Compare source location fields independently of object property order in diffs
  and change policies, preventing false source changes and CI rejections.
- Bound coercion diagnostics during generation, account for existing provenance
  before conversion, cap rule count by `maxProvenanceEvents` (including no-op
  rules), and skip coercion after merge failure. Standalone coercion accepts
  optional limits and incoming history; rule-count preflight returns empty config.
- Reject non-finite source priorities before loading or sorting, preventing silent
  precedence inversion and invalid numeric metadata in successful reports.
- Count array indexes and repeated references against `maxKeyCount`, stopping
  oversized/shared-array expansion before merge allocation. Large arrays may need
  an explicitly increased key/index budget.
- Preserve existing object fields and descendant provenance when a higher-priority
  source contributes an empty object under the deep-merge policy.
- Honor secret override mappings in core and Node helpers, preserving declared
  source policies and masking inspection values outside the CLI.
- Preflight CLI source counts before entry inspection or source I/O, sharing
  budget checks with direct source loading and rejecting unsafe integer limits.
- Watch both in-workspace file links and canonical targets; recheck boundaries
  and rebind target watches before loading after link replacement.
- Default Ajv validation to first-error execution and bound converted diagnostics
  with `maxIssues`; complete-error collection remains explicitly configurable.
- Return policy failure exit code 3 from ordinary CLI validation/explanation when
  diagnostic reporting exceeds its byte budget, instead of reporting success.
- Compare descendant source ownership beneath opaque secret objects so source-only
  changes cannot pass a `forbid-changes` rule when secret comparison is enabled.

### Added

- Node `loadConfigFileSource` for explicit JSONC, YAML, TOML and JSON5 files using
  bounded opened-file reads and existing structural/unsafe-key validation. Parser
  errors remain sanitized; JSONC locations and opt-in trailing commas are supported.
- CLI `kind: "adapter"` file sources with explicit format, the existing declaration
  directory boundary and shared loader budgets. Legacy commands and envelopes are
  unchanged; inspection, diff and CI policies use the same declared sources.
- Node workspace-bounded declaration discovery with deterministic filenames,
  nearest-directory precedence and a capped upward search. Configuration code is
  never executed and unsafe/broken candidates fail instead of being skipped.
- Opt-in CLI `explain`/`validate --discover <workspace>` and an opened-file root
  policy for declarations. Explicit config paths and legacy parser behavior remain
  unchanged; discovered files are rechecked when opened.
- Core structural Standard Schema v1 interoperability with inferred adapter output,
  awaited callbacks, bounded normalized issues and no provider prose or new runtime
  dependency. Resolved pipeline values retain the existing ADR 0009 behavior.
- Separate `runValidatedConfigPipeline` facade with inferred validated/transformed
  output, frozen validation inputs and shared budgets. Failed input exposes no
  successful typed value, and resolved config/provenance remain unchanged.
- Explicit named profile compilation with bounded declaration shape, preserved
  source priorities/identities and combined id/resource validation.
- Bounded local declaration inheritance with cycle detection, unique-ancestor
  ordering, workspace checks and retained per-declaration file source bases.
- CLI `--profile` and explicit `--workspace` selection for inspection, validation
  and both comparison inputs, without changing the synchronous legacy parser.
- Node serialized configuration reload with coalesced requests, immutable
  last-successful snapshots, sanitized events and explicit close semantics.
- Disposable, bounded Node file watching with workspace checks, parent-directory
  basename filtering, atomic replacement support and debounced refreshes.
- Non-destructive `uce init` with exclusive creation, a minimal usable declaration
  and sanitized `init-1` output, preserving existing files and symlinks.
- Shared-pipeline `uce doctor` with bounded sanitized diagnostics and finite,
  actionable advice for workspace, profile, syntax, validation and budget failures.
- Separate `public-diagnostic-1` report projection with ordinal source/path aliases,
  enum allowlists and no values, original names, locations, codes or prose.
- CLI `--public` for explain, validate and doctor, including private-input-safe
  usage/load failures and explicit rejection of value-bearing inspection modes.
- Opt-in actual core tarball consumers for Node, Bun, Deno and workerd, sharing
  portable feature assertions and recording runtime versions/artifact digests.
- Copyable adoption example covering profile/file precedence, typed validation,
  reload/watch disposal, public diagnostics and an executable three-rule CI case.

### Fixed

- Reuse the shared CLI output choice for doctor, including split JSON aliases,
  explicit human overrides and structured usage errors.

- Copy and validate the bounded file watch selection before asynchronous I/O,
  preventing later caller mutations from changing paths or bypassing the 64-path cap.

- Claim the reload execution slot before invoking an application loader, so a
  synchronous reentrant refresh stays queued and cannot overlap the initial load.

- Exclude redacted-path type/source/add/remove metadata from reload public change
  counts, in addition to skipping secret value comparison.

## 1.2.0 - 2026-10-21

- Promote verified `1.2.0-rc.1` with unchanged runtime, declarations, dependencies,
  package READMEs, fixtures and release tooling. All five packages use npm `latest`.
- Add safe value/path inspection, source-aware config comparison and bounded CI
  change policies while preserving default schema `0.2` and legacy commands.

## 1.2.0-rc.1 - 2026-10-21

### Added

- Opt-in safe scalar inspection and typed path explanations with retained source,
  override, location, coercion and validation history (`inspection-1`).
- Full-value configuration comparison, source changes and explicit in-memory
  secret-change detection without exposing secret values (`diff-1`).
- Bounded CI policies for forbidden changes, required paths and allowed winning
  sources (`change-check-1`), shared by core APIs and the `uce diff` command.
- Installed JavaScript, TypeScript and CLI consumer coverage for the new APIs,
  nested secret policies, limits and legacy command compatibility.

### Fixed

- Await Zod schema execution so asynchronous refinements and transforms complete
  before reporting results. Rejected callbacks reach core's sanitized exception
  boundary instead of leaving an unhandled rejection that can terminate Node.
- Share loader/validator issue-detail validation and reject non-finite numbers in
  legacy validator details, matching the existing loader boundary.
- Bound diagnostic retention during resolution without first copying the complete
  source issue array. Preserve issue order and source rejection for discarded errors.

## 1.1.2 - 2026-10-21

- Promote `1.1.2-rc.1` with unchanged runtime, public declarations, dependencies
  and package READMEs. All five packages use npm `latest`.

## 1.1.2-rc.1 - 2026-10-21

### Fixed

- Centralize validator provenance-budget accounting. Pipelines no longer reject
  valid history by subtracting it twice, and direct validation bounds incoming
  history plus new events before invoking further adapters.
- Reject unsupported asynchronous Ajv schemas at adapter creation, enforcing the
  existing synchronous schema contract for JavaScript callers before pending
  validation Promises can be mistaken for successful results.

- Own the Vite test peer explicitly and update it to 8.1.6, removing vulnerable
  8.1.3 peer snapshots from the development dependency graph.

## 1.1.1 - 2026-10-21

- Promote `1.1.1-rc.1` with unchanged runtime, public declarations, dependencies
  and package READMEs. All five packages use npm `latest`.

## 1.1.1-rc.1 - 2026-10-21

### Fixed

- Reject excessive source counts before full-list copying and sorting. Failure
  metadata retains the bounded declaration-order prefix instead of selecting from
  the globally sorted input; accepted source ordering and merging are unchanged.

## 1.1.0 - 2026-10-20

- Promote `1.1.0-rc.1` with unchanged runtime, public declarations, dependencies
  and package documentation. Add the optional JSON location metadata budget and
  the reliability/maintenance corrections listed in the candidate section below.

## 1.1.0-rc.1 - 2026-10-20

### Added

- Optional Node JSON-loader `maxLocationBytes`, defaulting to 4 MiB, bounds
  source-location metadata independently of config values and file size.

### Fixed

- Detach mapping and argv error paths from mapping declarations so later array
  reuse cannot misattribute diagnostics or change their redaction decisions.
- Detach coercion issue and provenance paths from rule arrays so later rule reuse
  cannot rewrite conversion history or its redaction decisions.
- Copy validator issue paths at normalization so adapter array reuse cannot rewrite
  earlier diagnostics or change their secret-path redaction decisions.
- Preserve loading preflight failures in pipeline results and reports so exceeding
  `maxSources` cannot return success or invoke validators on an empty configuration.
- Require error severity for diagnostic overflow markers so an adapter warning
  cannot hide truncated errors or cause an invalid source to resolve successfully.
- Apply loader diagnostic retention bounds during normalization, avoiding copies
  of discarded issue paths/details while still validating malformed tail entries.
- Bound JSON source location metadata to 4 MiB by default, configurable through
  `maxLocationBytes`. Excess metadata is omitted with a warning while config values
  remain usable, preventing quadratic path storage from exhausting memory first.
- Collect JSON file locations without recursive parsing so valid deeply nested
  files reach structural-limit checks rather than `json_parse_failed`.
- Freeze validator config iteratively so deeply nested configurations accepted by
  resolution do not reject the pipeline before validation starts.
- Inspect and clone deeply nested JSON iteratively so valid input reaches configured
  structural limits instead of syntax/set failures or stack overflow. Detect unsafe
  keys at deep positions without a recursive JSON reviver. Validate structures and
  replace deep indexed paths without recursion when callers select larger limits.
- Reject non-finite JSON mapping values before assignment, including nested
  numeric overflow. Share JSON checks with coercion and report unsafe JSON keys as
  `mapping/unsafe_key` instead of a late `mapping_set_failed` with partial targets.
- Preserve literal prototype-like input names through argv, env and dotenv
  mappings, and ignore inherited environment values before staging overrides.
- Ignore inherited mapping values and getters so absent inputs cannot become
  overrides, parse errors or exceptions through `Object.prototype` names.
- Recognize non-BMP Unicode argv mapping names in assignment form as well as split
  form, avoiding silent value loss or incorrect unmapped-argument errors.
- Make the public `isConfigValue` guard reject cycles and sparse arrays without
  stack overflow, while retaining shared references and deeply nested valid values.
- Apply depth and path-length limits to object scalar/null leaves, including
  leaves introduced by JSON coercion, through the shared value traversal.

### Maintenance

- Collect strict argv diagnostics during the value scan, removing duplicate
  mapping indexes and token traversal while preserving diagnostic order.
- Share Node file-source I/O and exception conversion between JSON and dotenv
  adapters while preserving parser-specific diagnostics and canonical locations.
- Separate core merge policy from resolved-path map/trie bookkeeping and coercion
  ownership projection without changing resolution order or provenance.
- Share core loader/validator boundary guards; reject negative indexes and sparse
  paths consistently in loader issues and source locations.
- Share the publishable package catalog and tarball names across release-state,
  candidate-readiness and consumer-smoke tools to prevent package-list drift.
- Wait for npm versions and dist-tags under one bounded propagation deadline,
  avoiding full release retries for normal registry delays.
- Reuse original GitHub tarballs on release retries, including pending npm
  publications, instead of overwriting public assets with a fresh repack.
- Allow release dry-runs after publication by inspecting immutable-version tarballs
  instead of asking npm to publish an existing version again.

## 1.0.0 - 2026-10-19

### Stable Contract

- Promote verified RC5 contents without further runtime, dependency, public
  declaration, package README, or release-runner changes.
- Establish the local config, provenance, redaction, validator, CLI and Node.js
  compatibility guarantees described in ADR 0016 and the 1.0 migration guide.
- Remove the four previously deprecated and ignored `ValidatorIssue` compatibility
  fields from the public type; diagnostic report schema `0.2` is unchanged.

## 1.0.0-rc.5 - 2026-10-19

### Fixed

- Return `ajv_custom_keyword` for Ajv custom keywords outside the core diagnostic
  code grammar instead of rejecting the adapter result or exposing keyword text.
- Scope whole-source redaction to sources that actually contributed to the path;
  preserve overridden-source path policies and combine source/report name patterns.
- Synchronize resolved paths after JSON coercion, reject unsafe JSON keys before
  assignment, and coerce existing array elements without changing public setter rules.
- Emit flattened arrays only after complete validation and bound diagnostics when
  invalid nested values exhaust the validation budget.
- Consume argv mapping values once, diagnose every undeclared token, and preserve
  lone dotenv quote characters. Unknown options no longer consume following tokens.
- Preserve Ajv missing/additional property paths and empty property names, reject
  invalid validator path indexes, and reject short options used as CLI option values.

### Maintenance

- Split CLI declaration/loading responsibilities and package tests, share bounded
  diagnostics and smoke helpers, and build the package graph once per workspace check.

### Security

- Raise the `fast-uri` override floor to `^3.1.7` and `source-map-js` to `^1.2.2`
  while retaining same-major updates. The resulting locked dependency graph passes
  the npm audit with zero reported vulnerabilities.

### Stable Release Preparation

- Prepare RC5 because Ajv behavior, dependency resolutions, packed smoke coverage,
  and the release runner have changed since RC4. Stable authorization is withdrawn
  until RC5 is published and its exact candidate commit is reviewed.
- Removed the fixed elapsed-time gate from stable promotion policy schema `0.2`;
  candidate artifact, provenance, registry, security, and exact-SHA checks remain.
- Publish the stable release with the migration guidance and compatibility
  contracts established during the RC line.

## 1.0.0-rc.4 - 2026-08-11

### Security

- Updated the Ajv transitive `fast-uri` resolution from `3.1.4` to `3.1.5` to
  clear `GHSA-7p8r-x3mc-p8w7` from the published CLI and Ajv adapter runtime path.
- Updated the Vite transitive `postcss` resolution from `8.5.16` to `8.5.26` to
  clear `GHSA-r28c-9q8g-f849` from the development toolchain.
- Established RC4 as the stable candidate because the dependency lock changed
  after RC3.

## 1.0.0-rc.3 - 2026-07-22

### Security

- Pinned the Ajv transitive `fast-uri` resolution to patched `3.1.4` after
  `GHSA-v2hh-gcrm-f6hx` made the reviewed RC2 lock fail the required high-severity
  audit gate.
- Established RC3 as the stable candidate because the dependency lock changed
  after RC2.

## 1.0.0-rc.2 - 2026-07-15

### Added

- Package-specific npm READMEs for core, Node adapters, CLI, Ajv, and Zod.
- A machine-enforced stable release policy covering the validated candidate,
  release assets, publication evidence, npm dist-tags,
  integrity, provenance, and registry installation.
- Tag-specific release note files consumed directly by the release workflow.
- Packed strict TypeScript migration checks that keep removed legacy validator
  fields out of the distributed declaration contract.

## 1.0.0-rc.1 - 2026-07-14

### Changed

- Removed the ignored `ValidatorIssue.category`, `message`, `sourceId`, and
  `details` compatibility fields after their `0.6.0` deprecation period.
- Classified the complete public declaration surface for stable `1.x` support.
- Froze diagnostic report schema `0.2`, CLI commands and exit codes, and the
  Node.js `>=24` compatibility contract for `1.x`.

### Added

- Deterministic generated invariant tests and operation-count complexity guards.
- Packed JavaScript, strict TypeScript, Node adapter, validator adapter, and CLI
  consumers across Ubuntu, Windows, Node.js `24.0.0`, and current Node.js.
- Prerelease-safe publication under npm `next` with GitHub prerelease marking,
  package-level publication manifests, provenance, and public registry smoke.

## 0.6.0 - 2026-07-14

### Changed

- Deprecated the four ignored legacy `ValidatorIssue` fields before their 1.0
  removal without changing runtime diagnostic behavior.

### Fixed

- Kept opened-file identity verification compatible with Windows Node.js `24.0.0`
  when path metadata does not expose a usable device identifier.

[Unreleased]: https://github.com/0disoft/universal-config-engine/compare/v1.0.0-rc.4...HEAD
[1.0.0-rc.4]: https://github.com/0disoft/universal-config-engine/compare/v1.0.0-rc.3...v1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/0disoft/universal-config-engine/compare/v1.0.0-rc.2...v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/0disoft/universal-config-engine/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/0disoft/universal-config-engine/compare/v0.6.0...v1.0.0-rc.1
[0.6.0]: https://github.com/0disoft/universal-config-engine/releases/tag/v0.6.0
