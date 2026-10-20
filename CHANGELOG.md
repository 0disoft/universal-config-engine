# Changelog

All notable changes to Universal Config Engine are recorded here. The project uses
semantic versioning and keeps package versions aligned across the workspace.

## Unreleased

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
