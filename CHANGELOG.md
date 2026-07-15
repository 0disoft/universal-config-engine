# Changelog

All notable changes to Universal Config Engine are recorded here. The project uses
semantic versioning and keeps package versions aligned across the workspace.

## Unreleased

### Added

- Package-specific npm READMEs for core, Node adapters, CLI, Ajv, and Zod.
- A machine-enforced stable release policy covering the reviewed candidate,
  minimum review duration, release assets, publication evidence, npm dist-tags,
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

[Unreleased]: https://github.com/0disoft/universal-config-engine/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/0disoft/universal-config-engine/compare/v0.6.0...v1.0.0-rc.1
[0.6.0]: https://github.com/0disoft/universal-config-engine/releases/tag/v0.6.0
