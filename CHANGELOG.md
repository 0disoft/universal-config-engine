# Changelog

All notable changes to Universal Config Engine are recorded here. The project uses
semantic versioning and keeps package versions aligned across the workspace.

## Unreleased

### Maintenance

- Share the publishable package catalog and tarball names across release-state,
  candidate-readiness and consumer-smoke tools to prevent package-list drift.

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
