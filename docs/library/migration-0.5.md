# Migration To 0.5

Status: Previous

`0.5.0` adds aggregate execution budgets, source locations, strict unmapped-input
policies, and hardened immutable pipeline boundaries.

## Package Update

Update the packages used by the consumer together:

```powershell
pnpm update @0disoft/universal-config-engine-core@0.5.0 `
  @0disoft/universal-config-engine-node@0.5.0 `
  @0disoft/universal-config-engine-cli@0.5.0 `
  @0disoft/universal-config-engine-validator-ajv@0.5.0 `
  @0disoft/universal-config-engine-validator-zod@0.5.0
```

## ResourceLimitPolicy

Code that constructs a complete `ResourceLimitPolicy` object must add:

```ts
{
  maxSources: 64,
  maxProvenanceEvents: 20_000,
  maxResolvedPaths: 10_000,
  maxReportBytes: 4 * 1024 * 1024
}
```

Callers that pass `Partial<ResourceLimitPolicy>` need no source change. Missing
fields use the defaults above. CLI JSON consumers must tolerate the four new fields
under `limits`.

Pipelines exceeding a new limit now fail with `resource-limit` diagnostics. An
oversized diagnostic report is replaced by a valid bounded error report; consumers
must not assume a successful resolution always implies `report.status === "ok"`.

## Diagnostic Report 0.2

The report schema changes from `0.1` to `0.2`. Resolved paths may contain
`winningLocation` and `overriddenLocations`, each with source id and optional source
path, line, and column. CLI paths are relative to the pipeline declaration. Consumers
that exhaustively match resolved-path fields or schema versions must accept the new
shape before upgrading.

## Optional Strict Inputs

No migration is required for existing process-env or argv sources. To detect typos,
set `unmappedBehavior` to `warning` or `error`. Process-env sources must also set a
namespace such as `unmappedPrefix: "MYAPP_"`. Do not use an empty prefix to inspect
the complete host environment.

## Immutable Coercion And Validation

`applyCoercionRules` no longer mutates its input config. Adopt the returned value:

```ts
const coercion = applyCoercionRules({ config, rules });
const normalizedConfig = coercion.config;
```

Validators receive isolated config and provenance snapshots. A validator can no
longer mutate the resolved pipeline result or data observed by later validators.
Source ids must also be unique within one resolution. CLI declarations additionally
reject duplicate validator ids and source/validator id collisions.

## New Public Helpers

- `combineConfigIssues` combines independently produced issue arrays while keeping
  the overflow marker inside `maxDiagnostics`.
- `readTextFileWithinLimit` success results include `canonicalPath`.
- `loadPipelineDeclarationContext` returns the normalized CLI declaration and the
  canonical path of the opened declaration file.
- Ajv `instancePathToConfigPath` accepts an optional root value to distinguish array
  indexes from numeric-looking object keys.

## Hardened Existing Policies

The final resolved config is checked after merge and coercion, so a pipeline can
now fail when aggregate structure exceeds its limits even if every individual
source passed. Equal or ancestor/descendant override targets are rejected before
mapping. Secret-name patterns are case-insensitive literal substrings rather than
regular expressions, and raw adapter or parser exception text is omitted from
public diagnostics.

## Compatibility Review

Update exhaustive `ResourceLimitPolicy` and report-schema consumers before moving
to `0.5.0`. Review callers that depended on coercion input mutation, regular
expression secret-name patterns, duplicate identities, or overlapping override
targets; those behaviors are intentionally no longer supported.
