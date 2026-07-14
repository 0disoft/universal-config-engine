# 1.0 Stability Plan

Status: Draft
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

The audit must resolve these known candidate decisions:

- retain or remove legacy `ConfigIssue`-shaped validator compatibility fields;
- freeze diagnostic report schema `0.2` or replace it before `1.0.0`;
- freeze CLI commands, flags, JSON envelopes, and exit codes;
- decide whether the open Node.js `>=24` upper range remains the stable contract;
- classify low-level helpers separately from the recommended `runConfigPipeline`
  facade without hiding existing exports.

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

## Release Gates

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
