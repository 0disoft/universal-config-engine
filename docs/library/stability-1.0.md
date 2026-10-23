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
The automaton is limited to 65,536 states. On overflow it releases its partial
states and reuses the exact normalized-pattern dictionary with an 8 KiB length
filter. Queries enumerate candidate substrings only for possible pattern lengths;
filter collisions still require an exact dictionary match and cannot redact an
unmatched name. Compilation is per report, with no global cache or new public
resource-limit error.

Overflow compilation also collects at most 32 distinct literal suffixes, each
at most four UTF-16 units. If a 33rd suffix occurs, the optional suffix list is
discarded; all patterns remain in the exact dictionary. Before allocating or
running the pair filter, an impossible query can return immediately when none of
these suffixes occurs in either normalized string. Empty-pattern rank still
applies, and contextual Unicode lowercasing retains the separate final-segment
check. The gate is bypassed when suffix count times the sum of normalized name
lengths exceeds 16 times the pattern count, bounding extra scans on long names.
The fixed list holds at most 128 UTF-16 units plus bounded container overhead;
filter buffers retain the existing 136 KiB ceiling. A rejected query needs only
the already compiled 8 KiB length buffer, with no lazy 128 KiB query allocation.

Overflow query planning has a 4,096-unit budget covering length scans, candidate
probes and candidate UTF-16 lengths. Names exceeding that budget lazily initialize
a prefix gate and allocate the existing 128 KiB query buffer. The prefix gate ORs
length-salted hashes of each pattern's first one to four UTF-16 units into the
existing 8 KiB length filter. Queries scan rolling
windows of only the prefix lengths present in the policy. If neither normalized
string has a possible prefix, the matcher returns the empty-pattern rank without
iterating the dictionary. This gate is bypassed when prefix-length count times
the combined lengths that need scanning exceeds four times the pattern count.
Hash/Bloom collisions only select the exact fallback, never a redaction decision.

Shared prefix bits can only add false candidate lengths to later short queries:
the 4,096-unit planner budget and exact dictionary verification still apply.
Existing length bits can only cause extra prefix positives, never missed matches.
Both sets of bits remain unchanged after initialization. No additional buffer or
per-pattern index is retained, and the query Bloom filter keeps its full 128 KiB
capacity. Each query inserts its adjacent UTF-16 pairs once;
patterns are rejected by up to four pair samples (start, quarter, middle, end)
before native literal verification. The quarter sample is skipped when it repeats
the start offset on short patterns. Repeated pairs avoid repeated insertions. A separately
lowercased final segment is inserted only when it is not already a joined-name
suffix. Hash collisions or out-of-order samples can only schedule exact searches;
they cannot change redaction. Each surviving pattern gets at most one search per
distinct normalized string, without allocating candidate substring windows.
The length and query filters retain 136 KiB of fixed auxiliary buffers, independent
of pattern count and name length, in addition to the existing normalized-pattern
dictionary. Only the separate query buffer is cleared per call, preserving shared
length/prefix bits across both successful and unsuccessful queries; there is no global
cache. No policy is truncated and no secret rule is skipped. Query filtering costs
one name scan plus constant work per pattern; saturated filters can still require
native searches for every pattern. This is not a universal linear-time guarantee.

`pnpm run benchmark:name-patterns` includes compilation plus 4,096 nonmatching
paths and reports five-run medians after warmup. Local measurements with 4,096
distinct patterns fell from about 1,280 ms to 18 ms; this synthetic workload does
not establish a production latency SLA. The deterministic guard doubles both
patterns and paths (512 to 1,024), requiring query operations to grow linearly;
the measured counts are 19,460 and 38,916.

The benchmark also forces overflow with 8,192 distinct patterns and 40 long
patterns. For 4,096 nonmatching paths, the former's query median fell from about
1,227 ms to 12 ms (compilation about 15 ms in both runs). The long-pattern case
fell from about 14 ms to 6 ms. The overflow complexity guard doubles patterns and
paths together and enforces linear query-operation growth, while limiting trie
insertions to the existing state budget. Doubling from 8,192 patterns/512 paths
to 16,384 patterns/1,024 paths produces 4,100 to 8,196 query operations.
Running the benchmark directly with
`node --expose-gc scripts/benchmark-name-patterns.mjs` additionally reports retained
heap and ArrayBuffer deltas; GC-dependent memory deltas are observations, not CI
thresholds. The added length-filter buffer is fixed at 8,192 bytes.

Long-name benchmarks use 8,192 patterns and 32 paths. Earlier pair-filter query
medians were about 7 / 13 / 33 ms at 4,096 / 16,384 / 65,536 UTF-16 units. The
bounded suffix gate avoids pattern-metadata visits for impossible shorter queries.
A separate benchmark includes the actual default patterns: at 256 / 1,024 / 4,096
units, local query medians changed from about 6.3 / 6.5 / 11.7 ms to
0.2 / 0.4 / 0.4 ms; first batches took about 0.5 / 0.3 / 0.4 ms. Suffixes that
occur coincidentally, a discarded list, or an excessive gate work estimate retain
the exact pair-filter fallback rather than promising a speedup on every policy.

The deterministic gate guard doubles patterns from 8,192 to 16,384 and name
length from 512 to 1,024. Four queries retain 64 suffix searches, zero pattern
character reads and zero lazy query-buffer allocations. A separate fixture with
more than 32 suffixes still exercises the fallback: doubling patterns and name
length produces 161,592 to 309,048 character reads including lazy prefix setup, zero unnecessary exact searches,
and exactly one 131,072-byte shared filter buffer per matcher.

The benchmark also covers 8,192 distinct four-unit suffixes and a shared suffix
that occurs without a complete pattern. With the actual default policy and 128
short paths, query medians changed from about 40 / 43 ms to 1.6 / 1.8 ms. First
batches including lazy setup changed from about 94 / 52 ms to 7.5 / 5.4 ms. The
deterministic guard doubles patterns from 8,192 to 16,384 with fixed queries:
four warm queries visit zero dictionary entries in both cases and retain 4,144 /
4,280 character reads respectively, independent of policy size. These are local
synthetic workloads, not production latency guarantees. Real prefix hits, Bloom
collisions and excessive gate work still use exact pair filtering and native
search. Sharing prefix and length bits can increase false positives in either gate;
the optimization does not promise a speedup or universal linear time for every
policy, and no pattern is discarded to meet the memory budget.
With 8,192 `0000`-prefixed numeric patterns and four queries beginning with
`0000` and ending with the common literal suffix, start/middle/end pair samples
all pass even though the numeric portion is absent. The additional quarter sample
rejects these candidates before native searches, without another index or buffer.
The permanent benchmark uses 4,096 / 16,384 repeated interior UTF-16 units with
fixtures allocated outside timing. Local seven-run query medians changed from
17.2 / 28.6 ms to 2.2 / 2.8 ms; first batches including lazy setup changed from
21.7 / 38.4 ms to 4.7 / 5.4 ms. These are synthetic measurements, not production
latency guarantees. The deterministic guard reduces exact searches for four
4,096-unit queries from 32,768 to 360; doubling patterns to 16,384 requires 680
searches, with character reads growing from 149,096 to 281,448. Both sizes retain
exactly 139,264 bytes of filter buffers. If all four sampled pairs occur or the
Bloom filter collides, exact searches remain necessary; the extra sample adds a
bounded probe and does not promise a speedup on every positive-prefix input.

Two additional eight-path fixtures use 16,384-unit names: 512 distinct candidate
lengths, and 128 lengths of `a~` repetitions against `b_` repetitions (equal
base-31 polynomial hashes). Query medians fell from about 1,688 / 5,962 ms to
3 / 3 ms. These are local synthetic measurements, not production SLAs. Guards
double both name length and pattern count, require linear filter work and zero
substring-window allocations, and also cover frequent filter positives: when all
sampled pairs occur but the literal pattern does not, exact searches grow from
256 to 512 rather than multiplying by the number of windows.

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
