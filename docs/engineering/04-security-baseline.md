# Security Baseline

Status: Draft

## Contract

Security baseline covers local config input safety, secret handling, output
validation, external adapters, logs, CI artifacts, and security blockers.

This repository does not currently own authentication, authorization, tenant
boundaries, hosted API security, database security, or remote secret delivery.

## Required Evidence

- Source of truth: `docs/product/02-spec.md`, `docs/architecture/02-runtime-flow.md`,
  `docs/library/public-api.md`, `docs/cli/output-and-exit-codes.md`
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Security Model

- Raw config values may contain secrets, internal hostnames, local file paths, user
  names, database URLs, and environment details.
- Diagnostic reports must be redacted before report structures are created.
- Redacted reports are secret-safe, not automatically public-safe.
- `__proto__`, `prototype`, and `constructor` path segments must not mutate object
  prototypes.
- Resource limits must bound file size, object depth, key count, diagnostics count,
  path length, and env var count.
- Parser and validator adapters are untrusted boundaries until tested by fixtures.
- No telemetry, persistence, or report upload is in MVP scope.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
- Raw secret values appear in diagnostics, snapshots, examples, logs, or CLI JSON.
- Redaction is implemented only as final string replacement.
- Core imports parser, validator, file-system, process, or CLI presentation
  dependencies.
- Unsafe key handling or resource limits are omitted from merge, mapping, or loader
  behavior once those surfaces exist.
