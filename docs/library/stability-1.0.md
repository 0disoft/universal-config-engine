# 1.0 Stability Plan

Status: Stable contract
Repository Type: library

## Baseline

`v0.5.0` is the feature-complete baseline for the current local configuration
engine scope. The path to `1.0.0` is contract stabilization, adversarial evidence,
and consumer validation rather than expansion into deferred service, secret-manager,
feature-flag, template, or parser-suite surfaces.

## Public Surface Audit

Before the first release candidate, every declaration in
`docs/library/public-api.snapshot.txt` must be classified as one of:

- stable: intended to remain compatible throughout the `1.x` line;
- candidate: retained only after an explicit keep, change, or remove decision;
- compatibility: an older shape with a documented deprecation period.

The baseline inventory is `docs/library/public-api-stability.md`. Candidate entries
remain public until a later accepted decision changes their classification.

ADR 0016 resolves the baseline candidate decisions as follows:

- legacy validator compatibility fields are deprecated in `0.6.0` and removed from
  the public type beginning with `1.0.0-rc.1`;
- diagnostic report schema `0.2` is frozen for `1.x`;
- CLI commands, flags, JSON envelopes, and exit codes are frozen for `1.x`;
- Node.js `>=24` remains open-ended with exact-floor and rolling-current gates;
- all existing low-level helpers remain stable alongside the recommended facade.

## Deprecation Contract

`1.0.0` requires a documented deprecation policy covering notice location,
minimum supported release window, runtime warnings, migration examples, and removal
criteria. No compatibility surface may be removed merely because a preferred facade
exists.

## Adversarial Evidence

Add deterministic generated tests, with recorded seeds on failure, for:

- nested merge order, same-priority conflicts, and provenance consistency;
- unsafe, overlapping, numeric-looking, and maximum-length config paths;
- coercion expansion followed by aggregate resource-limit enforcement;
- redaction subtree and literal-name matching without raw-value retention;
- malformed loader and validator outputs, mutation attempts, and diagnostic caps.

Generated cases must remain bounded by the documented resource policies. They must
not replace the existing hand-written regression and golden fixtures.

## Performance Evidence

Convert critical complexity expectations into deterministic assertions where
possible. Prefer bounded traversal, comparison, or retained-entry counts over
cross-run wall-clock thresholds. Existing merge-trie and argv timing benchmarks
remain local comparison tools and must record before-and-after evidence for hot-path
changes.

The complexity guard also counts resolved-path accesses during change-policy
evaluation and source-policy accesses during diagnostic redaction. Doubling both
rules and resolved paths (64/512 to 128/1024) produces 4,608 to 9,216 path reads;
doubling sources and paths (16/512 to 32/1024) produces 48 to 96 source-policy
reads. These are operation counts, not end-to-end latency measurements.

Policy prefix indexes and ownership/equality caches live for one comparison.
They preserve typed path segments and rule order. Redaction policies compile once
per report, retaining first-source and path-before-name reason precedence.
Up to 32 distinct normalized name patterns use native substring checks. Larger
policies share a ranked Aho-Corasick automaton: a path query scans its normalized
UTF-16 units, including a separate final-segment scan for contextual Unicode
lowercasing. Failure links inherit the earliest source rank without retaining
lists of suffix matches. Empty patterns and literal matching remain supported.
The automaton is limited to 65,536 states; policies exceeding this optimization
budget fall back to complete native matching rather than dropping patterns or
retaining unbounded per-character maps. Compilation is per report, with no global
cache or new public resource-limit error.

`pnpm run benchmark:name-patterns` includes compilation plus 4,096 nonmatching
paths and reports five-run medians after warmup. Local measurements with 4,096
distinct patterns fell from about 1,280 ms to 18 ms; this synthetic workload does
not establish a production latency SLA. The deterministic guard doubles both
patterns and paths (512 to 1,024), requiring query operations to grow linearly;
the measured counts are 19,460 and 38,916. Very large policies using the bounded
fallback retain the original pattern-by-path search cost.

## Consumer Matrix

The release candidate must pass packed or registry-backed consumers covering:

- JavaScript ESM and strict TypeScript library usage;
- core-only, Node adapter, Ajv adapter, and Zod adapter installations;
- the installed `uce` binary on Ubuntu and Windows;
- exact Node.js `24.0.0` and the latest stable Node.js release;
- migration examples from the latest `0.x` release.

`pnpm run smoke:consumer-matrix` owns the isolated packed scenarios, and
`.github/workflows/consumer-compatibility.yml` owns the operating-system and Node.js
matrix.

## Release Gates

### Candidate Promotion Contract

Stable promotion has no fixed elapsed-time requirement. All five candidate packages
must remain installable at the exact version under npm `next` while npm `latest`
continues to name the previous stable release.

A newly confirmed issue that requires a breaking public-contract change blocks the
stable release. The fix must ship as another release candidate and pass the same
candidate validation. Non-breaking fixes may also use another candidate when they
affect runtime or packaging behavior; the stable release must not silently differ
from the candidate that passed validation.

Immediately before stable release preparation, rerun the main CI, runtime
compatibility, consumer compatibility, release dry-run, exact registry package
smoke, and npm dist-tag/provenance checks against the intended stable commit.
Export the GitHub Dependency Graph SPDX SBOM while `main` still points to that
validated commit, record its SHA-256 digest before tagging, and require the
downloaded GitHub Release asset to match that digest after publication.
`release-policy.json` is the machine-readable stable-release gate. For `1.0.0` it
authorizes `1.0.0` only from the published, verified `1.0.0-rc.5` commit. The release workflow fails closed
while the candidate is missing or incomplete, but does not impose a time delay.

The candidate policy includes its exact `candidateCommitSha`. Stable readiness
peels annotated tags and requires that identity in the publication evidence. It
also verifies successful latest push runs by workflow file path for the exact
stable preparation SHA. Release dry-run and governance/SBOM validation remain
separate orchestration steps; the release workflow never waits for itself.

A `1.0` release candidate may be prepared only when:

- every public declaration has an explicit stability classification;
- candidate API, report schema, CLI, Node range, and deprecation decisions are
  recorded in accepted ADRs or source-of-truth documents;
- deterministic adversarial suites and complexity guards pass in hosted CI;
- the consumer matrix installs only packed release artifacts;
- a `migration-1.0.md` guide lists every intentional compatibility change;
- no unresolved known issue requires a breaking change.

`1.0.0` additionally requires a successful release-candidate registry smoke. Any
newly discovered breaking requirement returns the
work to another release candidate instead of changing the stable tag in place.

The preparation gates above were satisfied for `1.0.0-rc.1`, published at
`2026-07-14T10:11:01Z`, and its hosted release and exact registry package smoke
passed. Package documentation and release-gate improvements required
`1.0.0-rc.2`, so RC1 no longer matched the intended stable package contents.
RC2 was published at `2026-07-15T04:19:37Z`; its hosted release, npm metadata,
provenance, dist-tag, README, and exact registry package smoke checks passed.
The required high-severity audit later found `GHSA-v2hh-gcrm-f6hx` in the locked
`fast-uri@3.1.3` transitive dependency. RC3 pins patched `fast-uri@3.1.4` without
changing runtime source, public declarations, package READMEs, fixtures, smoke
logic, or the release runner. Because the dependency lock changed, stable
authorization moved to `1.0.0-rc.3`. New high-severity advisories later affected
the locked `fast-uri@3.1.4` runtime path and
`postcss@8.5.16` development path. RC4 resolves them to `fast-uri@3.1.5` and
`postcss@8.5.26` without changing runtime source, public declarations, package
READMEs, fixtures, smoke logic, or the release runner. Stable authorization
named `1.0.0-rc.4` at that point in the release history.

Subsequent Ajv fixes, dependency advisories, installed CLI failure checks, and
release-runner updates invalidated RC4 promotion. RC5 was published on 2026-10-19
from `45f2b7d476da880ed183f23ba59203c253dc4f5e`. Its successful tagged workflow,
complete 5/5 publication manifest, independently matched GitHub/npm tarballs,
integrity, source provenance, verified signatures and registry installation are
recorded in issue #1 and its GitHub prerelease assets. The separate metadata-only
stable preparation now records that exact `candidateCommitSha` in policy.

The RC5 baseline also includes scoped redaction, overridden-source policy merging,
coercion path projection and array updates, complete array validation, and adapter
argument/path boundary corrections. Earlier RC5 preparation evidence predates these
fixes and is superseded. RC5 checks and the dry-run bind the final preparation
commit in issue #1 and the annotated tag; stable checks must independently bind
the stable preparation commit. No stable tag is created by preparation alone.
