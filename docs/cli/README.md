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
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## Required Decisions

- Command list and flag ownership: draft commands are `explain` and `validate`.
- Exit-code taxonomy: see `docs/cli/command-contract.md`.
- Machine-readable output contract: JSON output is redacted by default and carries
  diagnostic report schema version `0.1`.
- Config precedence and default behavior: read from declared pipeline inputs only.
- Runtime compatibility floor: Node.js `>=24`.
- JSON usage errors for known commands are emitted as versioned JSON reports on
  stdout and exit `4`; unknown commands report usage on stderr and exit `4`.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
- CLI behavior diverges from the library pipeline contract.
