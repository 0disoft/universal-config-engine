# ADR 0006: Adapter Ecosystem Contract

Status: Accepted
Owner: UNASSIGNED

## Purpose

Define how parser and validator adapters can interoperate with Universal Config
Engine without moving format-specific parsing or validator dependencies into core.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Public library API: `docs/library/public-api.md`
- Adapter documentation: `docs/adapters/README.md`
- Compatibility fixtures: `docs/adapters/fixtures/`

## Decision

For the `0.1.x` baseline, YAML, TOML, INI, and JSON5 are adapter examples, not
first-party publishable parser packages. The repository may document fixture-backed
examples for these dialects, but it must not claim built-in parser support unless a
future ADR adds package ownership, parser dependencies, fixtures, and release gates.

Parser adapters interoperate through the existing `ConfigLoader` boundary:

- return a normalized config value;
- preserve source identity through `ConfigSourceDescriptor`;
- attach source locations when the parser can report them;
- convert parse or source failures into bounded `ConfigIssue` objects;
- keep parser-specific raw AST or token shapes out of core results.

Validator adapters interoperate through the existing `ValidatorAdapter` boundary:

- validate the normalized config object, not raw parser text;
- return normalized validation issues with config paths;
- keep typed validator output adapter-local;
- avoid replacing the pipeline output with validator-returned values.

Core does not copy thrown validator exception text into diagnostics. Free-form
messages and details are retained only for issues with a non-root normalized config
path, where report redaction can classify the diagnostic against declared secret
paths. Root and pathless issues retain structured status but use generalized text.

Compatibility fixtures live under `docs/adapters/fixtures/` and are checked by
`pnpm run check:adapter-fixtures`. Fixtures are contract examples for adapter
authors; they are not executable parser implementations and do not introduce parser
runtime dependencies.

## Rationale

The product value is explainable config resolution, not owning every file dialect.
Keeping dialect-heavy parsers outside core avoids dependency sprawl, parser security
surface area, and surprising format-specific behavior. Fixture-backed adapter
examples still give third-party authors a concrete contract for source identity,
location mapping, parse failures, and validation path reporting.

## Consequences

- Core remains zero-runtime-dependency and format-agnostic.
- Third-party parser authors can target stable loader and issue shapes.
- Adapter examples can improve without publishing first-party parser packages.
- A future first-party parser package requires a new ADR, dependency review, tests,
  release gates, and package metadata.

## Review Blockers

- A change adds YAML, TOML, INI, JSON5, or other parser dependencies to core.
- A change claims built-in parser support from a documentation fixture.
- An adapter exposes raw secret values in issues, diagnostics, logs, or fixtures.
- A validator adapter validates raw parser text instead of normalized config.
- A validator adapter replaces pipeline output with adapter-local typed output.
