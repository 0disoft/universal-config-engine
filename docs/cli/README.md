# CLI Tool

Status: Draft
Repository Type: cli-tool

## Repository Type Contract

The CLI is an inspection and validation companion for the library. It must not become
a daemon, remote config server, secret manager, or feature flag console.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Command contract: `docs/cli/command-contract.md`
- Technical owner: UNASSIGNED
- Related ADR: UNDECIDED

## Required Decisions

- Command list and flag ownership: draft commands are `explain` and `validate`.
- Exit-code taxonomy: see `docs/cli/command-contract.md`.
- Machine-readable output contract: JSON output must be redacted by default.
- Config precedence and default behavior: read from declared pipeline inputs only.
- Runtime compatibility floor: UNDECIDED.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
- CLI behavior diverges from the library pipeline contract.
