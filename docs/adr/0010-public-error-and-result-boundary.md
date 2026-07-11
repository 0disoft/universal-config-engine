# ADR 0010: Public Error and Result Boundary

Status: Accepted
Owner: UNASSIGNED

## Purpose

Define which public operations return diagnostics as data and which low-level
operations may throw.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public library API: `docs/library/public-api.md`
- CLI command contract: `docs/cli/command-contract.md`
- Adapter contract: `docs/adr/0006-adapter-ecosystem-contract.md`

## Decision

Universal Config Engine uses domain-specific result shapes rather than introducing
a generic `Result<T, E>` or `Option<T>` abstraction in the `0.x` API.

Expected configuration failures are data:

- resolution, merge, coercion, validation, redaction, and resource-limit failures
  use `ConfigIssue` inside result objects;
- loader and validator exceptions are caught at their adapter boundaries and
  converted to stable, secret-safe issues;
- malformed loader result objects are converted to
  `source-load/invalid_loader_result` rather than reaching merge as unchecked
  structures;
- exceptions raised while inspecting a loader's normalized value are converted to
  `parse/source_value_inspection_failed` with exception text omitted;
- high-level pipeline orchestration returns a complete pipeline result and does not
  reject for expected source, config, or validation failures;
- `runCli` converts expected failures into diagnostic output and documented exit
  codes.

Throwing is reserved for strict or low-level APIs where the caller explicitly owns
the boundary:

- strict parsing helpers may throw for invalid command or declaration input;
- low-level mutation helpers may throw for unsafe paths, unsupported numeric writes,
  or violated internal invariants;
- file primitives may reject for operating-system failures before a source loader
  converts them into issues;
- impossible states after successful validation may throw as programmer errors.

Raw third-party exception text is never part of a public diagnostic contract. An
adapter may retain a cause privately for local debugging, but issues, reports, CLI
output, fixtures, and thrown boundary errors must not copy secret-bearing causes.
Core loader exceptions, Node parser and filesystem exceptions, CLI declaration
parse failures, and validator compiler exceptions use stable issue codes and fixed
messages. User-controlled unknown option text is not echoed into usage reports.

## Rationale

The existing result types already carry config, provenance, sources, limits, and
bounded issues. Wrapping them in a second generic result layer would add nesting
without making failures clearer.

At the same time, forcing every low-level helper to return issues would make direct
programmer misuse harder to notice. The useful boundary is expected config failure
versus caller or invariant failure, not a blanket ban on exceptions.

## Consequences

- New high-level APIs must return domain result objects for expected failures.
- `runConfigPipeline` is the reference high-level boundary and returns
  `RunConfigPipelineResult` without rejecting for expected failures.
- New adapters must catch provider, parser, filesystem, and validator exceptions
  before returning to core orchestration.
- Public issue codes and categories are compatibility surfaces; raw exception text
  is not.
- Strict helper throws must be documented and tested when they are publicly
  exported.
- Changing an existing strict helper from throw to result, or the reverse, requires
  compatibility review.

## Validation

- Core tests cover loader and validator exception normalization.
- Core tests cover malformed loader issue/location rejection and descriptor-owned
  source identity normalization.
- Core tests cover throwing source values at both resolution and high-level pipeline
  boundaries.
- Node tests cover JSON parser and dotenv input text omission.
- CLI tests cover conversion of parsing and declaration failures into exit codes.
- CLI tests cover declaration parser, validator compiler, and unknown option text
  omission from JSON output.
- Package smoke tests cover high-level consumer behavior without exception-based
  control flow for expected failures.

## Review Blockers

- A high-level pipeline rejects for a normal config, source, or validation failure.
- Raw adapter or validator exception text reaches a public issue or report.
- A new generic result abstraction wraps existing domain result objects without a
  separate demonstrated need.
- A strict helper changes throw behavior without documentation and compatibility
  review.
