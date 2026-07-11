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
- documented throw-versus-result behavior;
- CLI JSON output when shipped in the same package.

## Breaking Changes

Major-version changes are required when a released API removes fields, changes
diagnostic meaning, changes adapter call order, changes default redaction behavior,
or changes merge/coercion semantics in a way consumers can observe.

## Minor Changes

Minor versions may add new optional fields, new adapter hooks, new diagnostics,
new CLI report sections, or new loader examples when existing behavior remains
compatible.

The 0.3 validator boundary adds `ValidatorIssue` while retaining optional legacy
`ConfigIssue`-shaped input fields. Removing those compatibility fields or changing
which structured fields core trusts requires a deliberate pre-1.0 minor or stable
major-version review.

The 0.3.1 Node loader adds optional `FileReadPolicy.allowedRootPath` to enforce the
already documented CLI file boundary at open-handle time. Existing callers that do
not configure a root retain their caller-owned path behavior.

The 0.4 release target adds optional loader and source limits, new stable failure
diagnostics, and stricter runtime validation of adapter results. Existing typed
adapters remain source-compatible when they already return valid `ConfigIssue` and
`ValueLocation` structures. See `docs/library/migration-0.4.md`.

## Patch Changes

Patch versions may fix incorrect provenance, redaction, validation, or parsing
behavior when the documented contract already required the corrected behavior.

## Decided Baseline

- Initial npm package version: `0.1.1`; see ADR 0005.
- Package ecosystem: TypeScript, ESM, and pnpm workspace; see ADR 0003.
- Release tooling: validation-gated tag releases publish through GitHub Actions
  Trusted Publisher; see ADR 0007.
