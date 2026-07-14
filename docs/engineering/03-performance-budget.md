# Performance Budget

Status: Draft

## Contract

Performance budgets track local resolution cost, source size, object depth, key
count, path length, diagnostics count, environment entry count, argument entry
count, package size, and CLI
execution behavior. Query count, cache behavior, background jobs, and hosted runtime
SLOs are out of scope until a future ADR adds a service surface.

The Node process-env and argv adapters default to at most 4096 input entries. Their
per-source `maxEnvEntries` and `maxArgvEntries` options may lower or raise that bound.
An oversized input is rejected before mapping.

Loader issue retention uses `maxDiagnostics` from the loader boundary onward. The
default limit is 200, and both per-source and aggregate issue arrays include the
overflow marker within that bound.

Pipeline declaration validation has a fixed 200-diagnostic bootstrap budget and
stops traversing once the in-budget overflow marker is emitted.

Runtime limit values must be positive safe integers. Invalid direct-library values
fall back to defaults; `NaN` and `Infinity` must never bypass a comparison-based
bound.

CLI override mapping target-path uniqueness is indexed by canonical path key, so
declaration validation scales linearly with mapping count while preserving the
first-declaration error reference.

The argv adapter compiles exact-name lookup and an assignment-prefix trie, then
scans argv without mapping-count multiplication. `pnpm run benchmark:argv` measures
256, 1,024, and 4,096 declared assignment forms in default and strict-warning modes
with warmup and five samples. The command verifies first/last mapped values and
reports local comparison timings; it is not a cross-machine SLA.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/architecture/03-quality-attributes.md`,
  `docs/library/public-api.md`, `docs/ops/ci.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Merge Path Trie Baseline

`pnpm run benchmark:merge-trie` builds core and measures two deterministic
10,000-key workloads:

- same-priority writes across a wide object, including bounded conflict diagnostics;
- replacement of a large resolved subtree by one higher-priority scalar path.
- resolution and diagnostic-report construction with 10,000 retained source
  locations.

The benchmark verifies result shape and reports warmup plus five timing samples as
JSON. Timings are local comparison evidence, not a cross-machine SLA, so this command
is intentionally excluded from the default `check` pipeline. Performance-sensitive
merge changes should record before-and-after results from the same machine and Node
version.

## Deterministic Complexity Guard

`pnpm run check:complexity` runs inside the default `check` pipeline. It measures
explicit `Map` operations in an isolated process for wide same-priority conflicts
and large subtree replacement at 512 and 1,024 keys. Doubling input may not exceed
twice the smaller operation count plus a fixed 64-operation allowance.

The same guard observes argv array element access through a Proxy. With 128
assignment-form arguments, default mode must read each element once and strict mode
twice, independent of whether 128 or 4,096 mappings are declared. This checks the
single-scan contract without using wall-clock thresholds or exposing production
instrumentation.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
