# Public API

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Technical owner: UNASSIGNED
- Related ADR: UNDECIDED

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
- `ConfigProvenance`: value-level source and override report.
- `RedactedDiagnostic`: secret-safe errors and explain output.

## Public API Principles

- Do not expose parser-specific raw shapes as core output.
- Do not require one schema validator library.
- Do not silently coerce values.
- Do not print or serialize secret values through diagnostic helpers.
- Preserve source identity for parse, merge, override, validation, and redaction
  failures.

## Open Decisions

- Exact package ecosystem and module format: UNDECIDED.
- Runtime compatibility floor: UNDECIDED.
- First validator adapter example: UNDECIDED.
- Error class or Result-style return convention: UNDECIDED.
