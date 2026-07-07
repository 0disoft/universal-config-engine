# Semantic Versioning

Status: Draft
Repository Type: library

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public API: `docs/library/public-api.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0003-implementation-language-and-package-strategy.md`

## Semver-Governed Surfaces

These surfaces are public once implemented and released:

- exported pipeline APIs;
- loader adapter interfaces;
- validator adapter interfaces;
- override mapping shapes;
- merge and coercion policy types;
- provenance report shapes;
- diagnostic and redaction report shapes;
- CLI JSON output when shipped in the same package.

## Breaking Changes

Major-version changes are required when a released API removes fields, changes
diagnostic meaning, changes adapter call order, changes default redaction behavior,
or changes merge/coercion semantics in a way consumers can observe.

## Minor Changes

Minor versions may add new optional fields, new adapter hooks, new diagnostics,
new CLI report sections, or new loader examples when existing behavior remains
compatible.

## Patch Changes

Patch versions may fix incorrect provenance, redaction, validation, or parsing
behavior when the documented contract already required the corrected behavior.

## Open Decisions

- Initial package version: `0.1.0`; see ADR 0005.
- Package ecosystem: TypeScript, ESM, and pnpm workspace; see ADR 0003.
- Release tooling: manual validation-gated release preparation; automated publish
  tooling remains UNDECIDED.
