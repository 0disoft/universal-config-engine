# Validation

Status: Draft

## Validation Source of Truth

This document owns stable validation names for this scaffold.

## Standard Validation Names

- format
- lint
- typecheck
- test
- contract
- migration-check
- smoke
- docs
- check

## Required Final Report

Final responses must list executed validations, passed validations, skipped validations, skip reasons, and remaining risk.

## Runner Policy

Task runner files are optional. Runner `none` means no executable task runner is generated.
If a runner is generated, runner command names must match this document.
Unconfigured runner commands must fail, not pass with a fake success.

## Hygiene Validation

Repository hygiene file changes must check line-ending churn, binary diff pollution,
tracked secret files, ignored build/cache artifacts, and generated-output drift.

## Scope

backend validation routes must stay stack-neutral unless a runner file explicitly defines a command.

## Package Test Layout

Core tests separate merge precedence, coercion, loader boundaries, validation, and
redacted reports. CLI tests separate output/golden reports, declaration checks,
canonical paths, source adapters, and validator setup. Tests remain beside their
package under `test/`; small shared fixtures live in `test/helpers/` rather than
being copied between suites.

Use a package's `test` command for standalone verification. The workspace `check`
builds dependencies once and runs `test:built` for all packages, plus the script
guards. Smoke helper guards cover cleanup after both success and failure and
preservation of unrelated release artifacts.

Node automatic-watch regressions cover inherited/source graph changes, selected
profiles, missing-directory recovery, last-good/repair subscriptions, obsolete
handle release, workspace escapes/aliases, path budgets and cancellation. Native
file events and injected event/handle ownership are checked separately. The packed
adoption example uses `watchConfig` without a manually maintained file list.

CI builds once, runs `check:built`, then `smoke:packages:built` to reuse that fresh
build without changing test coverage. `check:built` leaves artifacts intact;
both smoke modes clean them on success/failure. Standalone `check` still builds
and cleans, and standalone `smoke:packages` still builds before packing.

## Inspection and Comparison

Core regression suites cover value previews, nested/atomic-array secret policies,
precise typed paths, source locations and coercion/validation history, full-value
diff, source changes, secret-policy removal, query/entry/byte budgets and CI rules.
CLI suites retain legacy golden output and check opt-in formats and failure exits.
`pnpm run check` owns these suites and the public declaration snapshot.

`pnpm run smoke:packages` builds local tarballs, installs them in an isolated
consumer, and verifies JavaScript, strict TypeScript and the actual installed CLI.
The shared installed-CLI helper exercises seven inspection/diff/policy scenarios
alongside four legacy error cases. No additional hosted workflow or runner is added.

## Repository Shape

Opt-in `pnpm run smoke:portable-runtimes` executes actual core tarballs on selected
Node, Bun, Deno and workerd binaries; missing selected tools fail. See
`docs/library/portable-runtimes.md` for flags, version evidence and scope. This is
a local check, not an additional hosted workflow or a broader package engine claim.

library, cli-tool validation must stay repository-shape focused and must not imply generated application source code.

