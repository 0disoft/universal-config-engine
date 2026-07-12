# Testing Standard

Status: Draft

## Contract

Testing standard defines merge-blocking expectations for unit, integration, contract, migration, smoke, docs, and regression evidence.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/architecture/01-domain-model.md`,
  `docs/architecture/02-runtime-flow.md`, `docs/library/public-api.md`,
  `docs/cli/output-and-exit-codes.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Required Test Themes

- Path handling rejects or escapes unsafe keys.
- Merge fixtures cover priority ordering, object deep merge, array replacement,
  scalar replacement, explicit null overwrite, same-priority conflict, and source
  ordering.
- Provenance fixtures assert winning source, overridden sources, defaulting,
  coercion, validation, and redaction events.
- Redaction fixtures prove report structures and snapshots do not contain raw secret
  values.
- Resource-limit fixtures cover oversized files, excessive depth, excessive key
  count, excessive path length, excessive environment and argument entry counts,
  bounded diagnostics, and malformed runtime limits that must fall back to defaults.
- Structural-limit fixtures cover aggregate multi-source results and JSON coercion
  expansion, while traversal fixtures distinguish shared references from cycles.
- Mapping fixtures cover exact duplicate and ancestor/descendant target conflicts in
  both declaration orders.
- Validator adapter fixtures map external error paths to normalized config paths.
- CLI fixtures verify stdout, stderr, JSON output, exit codes, and shared pipeline
  behavior with the library.
- Package smoke tests install packed workspace tarballs into a temporary consumer,
  verify public exports and compatibility types, and execute the installed CLI binary.
- Adapter compatibility fixtures under `docs/adapters/fixtures/` must pass
  `pnpm run check:adapter-fixtures`.
- Loader boundary tests cover thrown adapters, malformed result structures, bounded
  issue retention, and descriptor-owned issue/location source identity.
- Validator boundary tests cover config and provenance mutation attempts, and source
  identity tests cover duplicate-id fail-closed behavior before reporting.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
- A final config object is tested without asserting provenance for changed paths.
- CLI output is tested without redaction and exit-code assertions.
- Golden reports include realistic secret prefixes or raw secret values.
