# ADR 0016: Stable 1.x Compatibility Contract

Status: Accepted

## Context

`v0.5.0` completes the current local configuration-engine feature scope, but the
public declaration snapshot still contains low-level helpers, programmatic CLI
stages, legacy validator fields, a pre-1.0 report schema number, and an open Node.js
runtime range. Stable release preparation requires explicit decisions for each
surface rather than treating only the recommended facade as public.

## Decision

All declarations exported in `v0.5.0` remain public. The low-level core helpers,
Node helpers, validator utilities, and programmatic CLI stages classified in
`docs/library/public-api-stability.md` are stable for `1.x`; they are not hidden or
removed merely because `runConfigPipeline` and the installed `uce` command are the
recommended entry points.

`ValidatorIssue.message`, `details`, `category`, and `sourceId` are the only
compatibility fields scheduled for removal. They remain ignored by core, receive
TypeScript `@deprecated` annotations in `0.6.0`, and are removed in `1.0.0` after a
migration guide. No runtime warning is emitted because library validation must not
write unsolicited output to consumer processes.

Diagnostic report schema `0.2` is the stable `1.x` JSON shape. Its version is an
independent data-contract identifier and does not need to match the npm package
major. A field addition, removal, type change, or semantic reinterpretation requires
a new report schema and an explicit compatibility path; `1.x` continues to emit
`0.2` by default.

The CLI stable contract consists of `explain` and `validate`, their documented
flags, the JSON command envelope and report `0.2`, and exit codes `0` through `5`.
Programmatic CLI exports retain their documented declaration, output, and error
contracts throughout `1.x`.

Node.js `>=24` remains the stable runtime range with no upper bound. Exact
`24.0.0` and the latest stable Node.js distribution remain hosted compatibility
gates. Dropping Node.js 24 support during `1.x` requires a new major release;
failures on a newly released upper version are treated as compatibility defects or
must trigger an explicit future upper-bound decision.

For deprecations introduced after `1.0.0`:

- add TypeScript `@deprecated` documentation, migration guidance, and release notes;
- retain the deprecated surface for the remainder of the current major line;
- remove it only in the next major release;
- avoid runtime warnings unless a separate ADR defines an opt-in warning channel.

## Low-Level Helper Contracts

- Core path comparison and formatting helpers are pure. `setConfigValueAtPath`
  mutates the supplied root, clones the assigned value, and throws for root,
  numeric-write, or unsafe segments. `cloneConfigValue` returns a detached config
  value and rejects unsafe object keys.
- Core value guards and flattening helpers preserve their documented result-oriented
  handling of malformed config values and resource limits.
- Node `checkFileSize` is a metadata preflight and does not provide the opened-file
  identity guarantee of `readTextFileWithinLimit`.
- Node `parseSimpleDotenv` parses already-loaded text and never expands shell syntax.
- Programmatic CLI stages remain bounded by the same declaration, redaction, report,
  and exit-code contracts used by the installed command.

## Consequences

- Stable status increases the compatibility burden for all existing exports.
- The `0.6.0` line is a deprecation release, not a removal release.
- Consumers matching report schema `0.2` can keep that parser through `1.x`.
- Future runtime-floor changes and deprecated removals require a major-version
  review once `1.0.0` is published.

## Review Blockers

- A `v0.5.0` export is removed before `1.0.0` without an accepted replacement ADR.
- Legacy validator compatibility fields are removed before the documented `1.0.0`
  boundary and migration guide.
- CLI or report behavior changes without a new compatibility decision.
- Hosted checks stop exercising either exact Node.js `24.0.0` or latest stable Node.
