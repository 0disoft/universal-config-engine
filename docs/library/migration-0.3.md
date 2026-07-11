# Migrating from 0.2.1 to 0.3.x

Use `0.3.1` or later. It retains the 0.3.0 consumer API and adds opened-file
identity verification for bounded JSON and dotenv sources.

## Package Update

Update all Universal Config Engine packages together:

```powershell
pnpm update @0disoft/universal-config-engine-core@0.3.1 `
  @0disoft/universal-config-engine-node@0.3.1 `
  @0disoft/universal-config-engine-cli@0.3.1 `
  @0disoft/universal-config-engine-validator-ajv@0.3.1 `
  @0disoft/universal-config-engine-validator-zod@0.3.1
```

Only list packages the project already uses. Node.js `>=24` and ESM remain the
runtime contract.

## Pipeline Facade

Existing stage-level calls remain supported. Consumers that own the standard
load, resolve, validate, and diagnostic flow may replace that orchestration with
`runConfigPipeline`:

```ts
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";

const { result, report } = await runConfigPipeline({
  loaders,
  context: undefined,
  validators
});
```

The facade does not change merge, coercion, validation, provenance, or redaction
semantics. Keep using individual stages when the application needs custom ordering
or intermediate results.

## Validator Issues

New validators should return `ValidatorIssue` values:

```ts
return {
  ok: false,
  issues: [
    {
      code: "port_out_of_range",
      severity: "error",
      path: ["server", "port"]
    }
  ]
};
```

Adapters returning the 0.2.1 `ConfigIssue[]` shape still compile and run. Core now
ignores validator-provided `category`, `message`, `sourceId`, and `details`. Public
validation issues use the registered validator id and a stable message generated
from the validator id and issue code.

Applications must stop parsing or displaying validator-provided diagnostic prose
from core reports. Use `code` and `path` to select application-owned, localized
messages. Call a validator adapter directly when its typed value or native error
object is required outside the core reporting pipeline.

## CLI File Sources

JSON and dotenv source paths still resolve from the pipeline declaration
directory. In 0.3.0, canonical filesystem paths are checked as well, so a symbolic
link or Windows junction cannot redirect a declared source outside that directory.
Move the target file under the declaration directory instead of relying on a link
to an outside location.

Starting with 0.3.1, the CLI also passes the declaration directory to the Node
loader. The loader verifies the canonical path and opened file identity before it
reads JSON or dotenv contents.

## Unchanged Contracts

- CLI commands remain `explain` and `validate`.
- CLI JSON report schema remains `0.1`.
- Validator-returned typed values remain adapter-local and do not replace resolved
  config.
- Expected pipeline failures remain domain issues/results rather than thrown
  exceptions.
