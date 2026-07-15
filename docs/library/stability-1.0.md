# 1.0 Stability Plan

Status: Release Candidate
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

### Review Period Contract

The stable release requires a minimum seven-day (`168` hour) public review period.
The clock starts at the GitHub prerelease `publishedAt` timestamp, not at the local
commit or tag time. Throughout the period, all five packages must remain installable
at the candidate's exact version under npm `next` while npm `latest` continues to
name the previous stable release.

A newly confirmed issue that requires a breaking public-contract change blocks the
stable release. The fix must ship as another release candidate, and the review
period restarts from that candidate's publication timestamp. Non-breaking fixes may
also use another candidate when they affect runtime or packaging behavior; the
stable release must not silently differ from the candidate that completed review.

Immediately before stable release preparation, rerun the main CI, runtime
compatibility, consumer compatibility, release dry-run, exact registry package
smoke, and npm dist-tag/provenance checks against the intended stable commit.
`release-policy.json` is the machine-readable stable-release gate. For `1.0.0` it
names `1.0.0-rc.2` as the reviewed candidate and requires `168` hours. The release
workflow derives the exact not-before timestamp from that GitHub prerelease's
`publishedAt` value and fails closed while the candidate is missing or incomplete.

`1.0.0-rc.1` may be prepared only when:

- every public declaration has an explicit stability classification;
- candidate API, report schema, CLI, Node range, and deprecation decisions are
  recorded in accepted ADRs or source-of-truth documents;
- deterministic adversarial suites and complexity guards pass in hosted CI;
- the consumer matrix installs only packed release artifacts;
- a `migration-1.0.md` guide lists every intentional compatibility change;
- no unresolved known issue requires a breaking change.

`1.0.0` additionally requires a successful release-candidate registry smoke and a
documented review period. Any newly discovered breaking requirement returns the
work to another release candidate instead of changing the stable tag in place.

The preparation gates above were satisfied for `1.0.0-rc.1`, published at
`2026-07-14T10:11:01Z`, and its hosted release and exact registry package smoke
passed. Package documentation and release-gate improvements require
`1.0.0-rc.2`, so the RC1 review window no longer authorizes stable publication.
Stable `1.0.0` remains blocked until RC2 is published, its derived review window
ends, and the final checks above pass without a confirmed breaking blocker.
