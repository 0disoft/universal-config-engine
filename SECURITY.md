# Security Policy

## Scope

Universal Config Engine is a local library and CLI project. Security reports in
scope include:

- raw secret values exposed through diagnostics, fixtures, tests, thrown errors, or
  package artifacts;
- prototype-pollution or unsafe path handling that can mutate object prototypes;
- resource-limit bypasses that can cause unbounded local processing or output;
- parser or validator adapter behavior that corrupts normalized config diagnostics;
- release artifacts or package metadata that expose sensitive material.

Hosted API, database, authentication, authorization, tenant isolation, deployment,
secret storage, encryption, rotation, KMS, and remote config delivery are outside
this repository's current product scope.

## Reporting

For sensitive reports, do not open a public issue with credentials, raw secret
values, private config files, or exploit details. Use GitHub private vulnerability
reporting when available on the repository. If private reporting is unavailable,
open a minimal public issue that asks for a private contact path without including
sensitive details.

For non-sensitive bugs, documentation drift, package metadata issues, or release
process questions, use a regular repository issue.

## Response Expectations

Maintainer response is best-effort until a formal service-level security process is
published. Security fixes must preserve the product boundary, keep core
format-agnostic, and pass the documented validation gates before release.

## Validation Gates

Security-sensitive changes must run:

```powershell
pnpm run check
pnpm run smoke:packages
git diff --check
ssealed doctor
```

CodeQL analyzes JavaScript and TypeScript sources with the `security-extended`
query suite on `main`, pull requests, a weekly schedule, and manual dispatch. All
remote workflow actions must be pinned to full commit SHAs; Docker actions must be
pinned by digest. A failed scan or confirmed untriaged security finding blocks a
release.

Release is blocked if tracked files, fixtures, generated reports, package artifacts,
or CLI output expose raw secret values.
