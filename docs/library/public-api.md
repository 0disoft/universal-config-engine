# Public API

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Candidate API Areas

- `ConfigSource`: source identity, priority, loader, and redaction metadata.
- `ConfigLoader`: adapter interface that returns normalized config data and source
  metadata.
- `ConfigPipeline`: ordered execution of load, override, merge, coerce, validate,
  and report steps.
- `OverrideMapping`: explicit env var or CLI flag mapping into config paths.
- `MergePolicy`: deterministic object merge and conflict handling.
- `CoercionPolicy`: opt-in type conversion rules.
- `ValidatorAdapter`: validation boundary for consumer-selected validators.
- `ConfigProvenance`: value-level source, override, default, coercion, validation,
  and redaction report.
- `RedactedDiagnostic`: secret-safe errors and explain output.
- `ResourceLimitPolicy`: bounds for file size, object depth, key count, path length,
  diagnostics count, and source size.
- `ConfigIssue`: source-aware issue taxonomy for load, parse, mapping, merge,
  coercion, validation, redaction, and resource-limit failures.

## Package Boundary Direction

Package naming beyond core remains provisional, but public API ownership is layered:

- `@universal-config-engine/core`: pure config values, paths, sources, merge,
  provenance, diagnostics, redaction, result, and adapter interfaces.
- runtime source package: file-system, process env, argv, JSON file, and simple
  `.env` source helpers.
- CLI package: command parsing and presentation only.
- `@universal-config-engine/validator-zod`: optional Zod validator integration.
- validator adapter packages: optional dependencies on validator libraries.
- fixture package or directory: shared behavior cases and golden reports.

The core package must not depend on parser libraries, validator libraries, Node.js
file-system APIs, process env, argv parsing, or CLI presentation libraries.

## Public API Principles

- Do not expose parser-specific raw shapes as core output.
- Do not require one schema validator library.
- Do not silently coerce values.
- Do not print or serialize secret values through diagnostic helpers.
- Preserve source identity for parse, merge, override, validation, and redaction
  failures.
- Generate provenance during resolution rather than reconstructing it from the final
  object.
- Reject or safely escape unsafe keys before path setters or deep merge can mutate
  object state.
- Return bounded issues for resource-limit failures.
- Keep raw secret values out of diagnostic report structures, snapshots, thrown
  errors, and CLI JSON.

## Open Decisions

- Exact package ecosystem and module format: TypeScript ESM; see ADR 0003.
- Runtime compatibility floor: Node.js `>=24`; see ADR 0003.
- First validator adapter example: Zod via `@universal-config-engine/validator-zod`.
- Error class or Result-style return convention: UNDECIDED.
- Package boundary names beyond core: UNDECIDED.
- Diagnostic report schema versioning: UNDECIDED, but required before CLI JSON is
  implemented.
