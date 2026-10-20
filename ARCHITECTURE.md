# Architecture

Status: Draft

## Boundary

Universal Config Engine owns config source registration, loader adapter boundaries,
source priority, normalized config objects, merge/coercion policy, validator adapter
handoff, value-level provenance metadata, and secret-safe diagnostics.

It consumes raw config sources and optional parser or validator adapters. It must not
own remote config storage, secret rotation, feature flag rollout, application runtime
state, or database persistence.

## Runtime Flow

1. Register sources with names, priority, loader, and redaction policy.
2. Load each source into a normalized object plus source metadata.
3. Apply declared env var and CLI override mappings.
4. Merge sources in explicit order.
5. Emit provenance events while merge, override, default, and coercion decisions are
   made.
6. Apply default and typed coercion policy.
7. Run validator adapters against the normalized config object.
8. Return resolved config plus diagnostics, provenance, and redacted report data.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: secret values must be redacted from diagnostics by default.
- Compatibility: parser and validator adapters must remain replaceable.
- Operability: CLI output must explain parse, merge, validation, and redaction failures.
- Predictability: source priority, merge policy, and coercion policy must be explicit.

## Package Boundary Direction

The implemented package layout follows a layered boundary:

- core owns pure config value, path, source, merge, provenance, validation-adapter,
  redaction, diagnostics, and result contracts.
- runtime source adapters own file-system, process env, argv, and parser integration.
- CLI owns command parsing and human or JSON presentation only.
- validator adapters own optional dependencies on validation libraries.
- fixtures own repeatable behavior examples and no-secret snapshot evidence.

Core must not import file-system, process, CLI, parser, or validator libraries.

Core's internal `adapter-guards.ts` owns record, issue-code and config-path shape
checks shared by loader and validator boundaries. It is not a package entry point.

Core's internal `json-value.ts` owns JSON parsing, unsafe-key detection and finite
value checks shared by mapping and coercion. Each stage owns its diagnostic
category, codes and messages; parsing failures never reach the mutation helpers.
JSON checks, `value.ts` structural validation and `path.ts` value cloning use
explicit traversal stacks so encoded nesting reaches resolution's structural
budgets rather than recursive reviver or copy failures. Native parsing remains
subject to adapter-owned raw-input bounds.
Structural validation maintains one mutable traversal path and copies only emitted
paths; array emission still waits for complete validation within the issue budget.

`merge.ts` owns source ordering, precedence, provenance and resolution budgets.
Its internal `resolved-path-index.ts` owns the synchronized path map/trie,
overlap lookup and ownership projection after coercion. Trie mutations stay in
that module so merge policy changes do not need to reimplement index bookkeeping.
Descendant collection and path pruning are iterative so caller-selected high depth
limits also work when a later source replaces a deeply nested path.

Node's internal `file-source.ts` shares bounded text-file loading and exception
conversion between JSON and dotenv adapters. Each adapter keeps its parser,
source-location extraction and existing format-specific failure codes. The
open-handle identity/root checks and byte limits remain in `file.ts`.
The JSON adapter uses native parsing for syntax and a token scanner for locations.
Position collection is iterative and skips array descendants, whose individual
locations are not retained; it does not impose a separate structural depth policy.
Location collection has an independent UTF-8 record budget to bound metadata
amplification from copied ancestor paths. Exceeding it omits the optional locations
with a warning while preserving parsed values and resolution's structural policy.

Node's argv adapter builds one mapping-name index per call. Its single scan owns
both value consumption and unmapped-token classification, keeping strict mode's
diagnostics consistent with the tokens that actually supplied mapped values.

Core's internal `diagnostics.ts` owns ordered, bounded issue collection and overflow
markers for loading, merging, validation, and the pipeline facade. CLI declaration
checks reuse the public `combineConfigIssues` facade with their fixed bootstrap
budget and CLI-specific overflow wording; they do not import core internals.

## CLI Declaration Processing

`packages/cli/src/pipeline.ts` keeps the existing declaration-loading entry points
and re-exports source loading and declaration errors. Internal responsibilities
live under `packages/cli/src/pipeline/`:

- `declaration-validation.ts`: pure declaration checks and issue ordering.
- `declaration-normalization.ts`: rebuilds validated input as typed declarations.
- `declaration-fields.ts`: supported fields, limits, and shared shape guards.
- `declaration-diagnostics.ts`: declaration errors and the bootstrap diagnostic cap.
- `source-paths.ts`: canonical paths and declaration-directory boundaries.
- `source-loading.ts`: dispatch to runtime adapters and attach source locations.

Internal modules do not import the public facade. Declaration processing preserves
the 200-issue bootstrap cap, source ordering, redaction, and existing CLI reports.
