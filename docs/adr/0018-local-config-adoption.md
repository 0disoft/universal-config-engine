# ADR 0018: Local Configuration Adoption

Status: Accepted

## Purpose

Follow ADR 0017 with easier local adoption while retaining explainable resolution,
zero runtime dependencies in core, bounded work, secret-safe diagnostics and the
existing default CLI envelopes. External review scores are opinions, not release
criteria or performance measurements.

## Delivery Units

Implement, verify and commit these units sequentially on the existing main branch.
Unpublished development is recorded in the changelog and does not authorize push
or another release.

1. First-party JSONC, YAML, TOML and JSON5 file loaders in the Node package, then
   their CLI integration. Reuse the opened-file identity, root and byte boundaries.
   Parsers remain outside core and are loaded only for the requested dialect.
   JSON retains its existing strict parser. Reject parser errors, unsafe keys,
   non-finite values and non-JSON runtime types; never print parser exceptions.
   YAML rejects duplicate keys, unknown tags and uncontrolled alias expansion.
   TOML date/time objects are unsupported until a separate normalization policy
   is selected; they must not be silently converted or discarded.
2. Explicit, bounded configuration discovery inside a caller-selected workspace.
   Search a documented ordered filename list; never execute JS/TS config, walk
   indefinitely toward the filesystem root or infer arbitrary env/argv mappings.
   Preserve exact explicit-path behavior. Discovery reports the selected input
   rather than hiding where configuration came from.
3. Standard Schema interoperability and a separate typed pipeline facade.
   Structural Standard Schema v1 types avoid introducing a core runtime package.
   Await synchronous/asynchronous validators once, normalize issue paths and omit
   provider prose. Return validated/transformed output separately from resolved
   config; diagnostics and provenance still describe the resolved input. Existing
   `runConfigPipeline` and ADR 0009 remain unchanged. Failed validation exposes no
   successful typed value, and successful typed values may themselves be secret.
4. Explicit environment profiles and bounded local declaration inheritance inside
   a workspace. Resolve inheritance deterministically, detect cycles and retain
   each config source's identity. Selecting a profile must be explicit; never read
   process environment implicitly to change precedence. Retain each declaration's
   file-relative base without weakening the workspace boundary.
5. Safe reload and file watching in the Node layer. Serialize refreshes, coalesce
   bursts, retain the last successful snapshot when loading/validation fails,
   automatically track declarations, inheritance and selected file sources through
   `watchConfig`, and update bounded subscriptions before reads. Preserve repair
   subscriptions on failure and drop obsolete dependencies after a valid load;
   expose safe change metadata and support explicit close/disposal. Do not mutate
   a published snapshot or place filesystem/process APIs in core. A failed refresh
   is observable and must not appear as a successful configuration change.
6. `uce init` and `uce doctor` for local onboarding and diagnosis. Initialization
   creates a usable minimal declaration without overwriting existing files.
   Diagnosis uses the shared pipeline and offers stable safe codes and concrete
   fixes without printing environment values or secrets. Existing parser exports
   and legacy command types retain their contracts. ADR 0017 already supplies CI
   change checks; do not add a second policy engine.
7. A separate public-share report projection. Omit scalar values and original
   source ids, names, paths, filenames, diagnostic prose and arbitrary details.
   Keep only a documented allowlist with stable per-report pseudonyms. Secret-safe
   legacy reports remain unchanged and must not be advertised as public-safe.
8. Reproducible consumers for Node, Bun, Deno and Workers, with package-specific
   scope. Core may run where standard ECMAScript APIs are available; the Node
   adapter/CLI retain filesystem/runtime requirements. Verify actual artifacts and
   report unavailable runtimes honestly; do not widen all package engine promises
   based on a core-only smoke. Prefer local opt-in checks over more hosted jobs.
9. Copyable adoption examples and an executable comparison/change-control case.
   Document what was measured, relevant limitations and the supported runtimes.
   Stars, adoption and score improvements require external evidence and cannot be
   declared achieved by implementation or synthetic tests.

## Parser Dependencies

The existing `jsonc-parser` supplies JSONC; its error list must be checked when
using the tolerant parser. Evaluate `yaml` major 2 (ISC), `smol-toml` major 1
(BSD-3-Clause) and `json5` major 2 (MIT) in the Node adapter. These packages have
no mandatory parser runtime dependency graphs and support the existing Node floor.
Use major ranges for added dependencies, retain a reviewed lockfile and audit the
actual resolution. Do not add a package solely for filename search or watching.

Primary references:

- [JSONC parser contract](https://github.com/microsoft/node-jsonc-parser)
- [YAML parsing and conversion options](https://eemeli.org/yaml/)
- [TOML parsing, dates and key safety](https://github.com/squirrelchat/smol-toml)
- [Standard Schema specification](https://standardschema.dev/schema)

## Validation and Release

Use related package tests and typechecks for each unit, update and review the
declaration snapshot when exports change, and run the workspace check and packed
consumer smoke after integration. Regression checks target safety and user-visible
behavior rather than duplicating implementation details. No new hosted workflow
is required by this decision. Any future publication must use a new candidate and
the existing exact-commit stable promotion gates.
