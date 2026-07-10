# ADR 0011: Structured Validator Diagnostics

Status: Accepted
Owner: UNASSIGNED

## Purpose

Define the trust boundary between third-party validator output and public
diagnostic reports.

## Source of Truth

- Public library API: `docs/library/public-api.md`
- Adapter contract: `docs/adapters/README.md`
- Public error boundary: `docs/adr/0010-public-error-and-result-boundary.md`

## Decision

Validator adapters return `ValidatorIssue` values. The authoritative fields are:

- `code`: stable validator-specific ASCII machine identifier, starting
  with a letter and limited to 128 characters;
- `severity`: `error` or `warning`;
- `path`: optional normalized config path.

Core converts each valid `ValidatorIssue` into a public `ConfigIssue`. Core assigns
the `validation` category, uses the registered validator id as `sourceId`, and
constructs a stable generic message from the validator id and issue code.

For compatibility with adapters built against the pre-0.3 `ConfigIssue`-shaped
contract, `ValidatorIssue` temporarily accepts optional `category`, `message`,
`sourceId`, and `details` fields. Core validates their basic shape but never copies
them into public diagnostics. First-party adapters and compatibility fixtures must
emit only the authoritative structured fields.

Thrown exception text and validator-provided free-form text must not enter public
issues, reports, provenance, snapshots, or CLI output. A future removal of the
legacy compatibility fields requires a deliberate semver review.

Codes that do not match `[A-Za-z][A-Za-z0-9_.:-]{0,127}` are malformed validator issues.
This prevents whitespace, assignment syntax, and arbitrary diagnostic prose from
being smuggled through the machine-code field.

## Rationale

Path-based redaction cannot prove that arbitrary validator text is safe. Even a
diagnostic attached to a non-secret path can contain a secret, provider payload, or
spoofed source identity. Reconstructing public issues in core makes the validator
boundary deterministic and keeps external text outside the report model.

## Consequences

- Validator authors lose custom diagnostic prose in core reports.
- Consumers can map stable issue codes to their own localized or richer UI text.
- Existing adapters returning validation `ConfigIssue` objects remain input
  compatible while their untrusted fields are ignored.
- First-party Ajv and Zod adapters no longer forward library error messages.

## Review Blockers

- Core copies validator-provided `message`, `details`, or `sourceId` into a public
  diagnostic.
- A first-party validator adapter emits free-form provider text.
- A validator fixture requires fields beyond `code`, `severity`, and optional
  `path`.
