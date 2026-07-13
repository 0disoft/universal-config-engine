# ADR 0014: Source Location Reporting

Status: Accepted

## Context

Loader adapters can return `ValueLocation` entries, but resolution previously
discarded them. Consumers could identify the winning source but not the file, line,
or column that produced a value. Human `explain` output also omitted provenance
events already retained by core.

## Decision

`ResolvedPath` and `DiagnosticReportResolvedPath` carry optional
`winningLocation` and `overriddenLocations`. Locations follow the same winner
transitions as source ids. Override history is ordered from older retained
locations to the current winner, and locations are omitted when unavailable.

The Node JSON loader uses `jsonc-parser` only for its zero-dependency visitor and
offset metadata. `JSON.parse` remains the value parser, comments and trailing commas
remain invalid, and JSONC is not a supported dialect. JSON scalar, array, and empty
object values receive 1-based line and column locations. The dotenv loader records
the accepted key position. Repeated paths retain the last location, matching the
last value retained by those loaders.

Node loader locations contain the canonical opened path. The CLI rewrites that path
relative to the canonical pipeline declaration directory before reporting it. This
keeps CLI output portable without weakening the opened-file boundary.

Diagnostic report schema version is `0.2`. Human `explain` output prints winning and
overridden locations and a provenance section. Existing aggregate provenance,
resolved-path, and report-byte budgets apply.

## Consequences

- Consumers matching report schema `0.1` must migrate before reading location fields.
- `jsonc-parser` is a runtime dependency of the Node package, pinned through the
  workspace lockfile. It is MIT licensed and has no runtime dependencies.
- Sources and adapters without locations continue to resolve normally and omit the
  optional location fields.
