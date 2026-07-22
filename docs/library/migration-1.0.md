# Migration To 1.0

Status: Release Candidate

The `1.0` release candidate removes four ignored compatibility fields from the
public `ValidatorIssue` type. Runtime validation, diagnostic report schema `0.2`,
CLI commands and exit codes, and the supported Node.js range remain unchanged.

## Package Update

Update every Universal Config Engine package used by the consumer to the same
release-candidate version:

```powershell
pnpm update @0disoft/universal-config-engine-core@1.0.0-rc.3 `
  @0disoft/universal-config-engine-node@1.0.0-rc.3 `
  @0disoft/universal-config-engine-cli@1.0.0-rc.3 `
  @0disoft/universal-config-engine-validator-ajv@1.0.0-rc.3 `
  @0disoft/universal-config-engine-validator-zod@1.0.0-rc.3
```

Release candidates are published under the npm `next` tag. Installing a package
without an explicit version continues to select the latest stable `0.x` release
until stable `1.0.0` is published.

## Validator Issue Type

Validator adapters must return only the structured fields trusted by core:

```ts
return {
  ok: false,
  issues: [{
    code: "invalid_port",
    severity: "error",
    path: ["service", "port"]
  }]
};
```

Remove these fields from values declared directly as `ValidatorIssue`:

- `category`;
- `message`;
- `sourceId`;
- `details`.

Core has ignored those fields since `0.3`. It constructs each public `ConfigIssue`
from the registered validator id, bounded machine code, severity, and normalized
path. The removal is therefore a TypeScript declaration cleanup, not a diagnostic
runtime change.

JavaScript adapters and structurally wider TypeScript values can still contain
extra properties at runtime. Core continues to ignore them defensively, but they
are no longer part of the supported adapter contract.

## Stable Contracts

No other intentional compatibility change is included in the first `1.0` release
candidate:

- diagnostic JSON remains schema `0.2`;
- CLI commands, flags, JSON envelopes, and exit codes remain unchanged;
- Node.js support remains `>=24`;
- low-level helpers and programmatic CLI stages remain public;
- validator `value` remains adapter-local and does not replace pipeline config.

Before adopting stable `1.0.0`, test the release candidate against the consumer's
own validator adapters and any code that narrows diagnostic types.
