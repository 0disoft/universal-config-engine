# Migration to 0.4

Status: Release target

`0.4.0` is an additive API release with stricter runtime enforcement at loader,
resource-limit, and CLI declaration boundaries. Package versions remain `0.3.1`
until the release preparation commit is validated and tagged.

## Package Update

After `0.4.0` is published, update the packages used by the consumer together:

```powershell
pnpm update @0disoft/universal-config-engine-core@0.4.0 `
  @0disoft/universal-config-engine-node@0.4.0 `
  @0disoft/universal-config-engine-cli@0.4.0 `
  @0disoft/universal-config-engine-validator-ajv@0.4.0 `
  @0disoft/universal-config-engine-validator-zod@0.4.0
```

## New Source Limits

Node process environment and argv sources accept optional positive-integer limits:

```ts
createProcessEnvSource({
  descriptor,
  env: process.env,
  mappings,
  maxEnvEntries: 4096
});

createArgvSource({
  descriptor,
  argv: process.argv.slice(2),
  mappings,
  maxArgvEntries: 4096
});
```

Both defaults are 4096. Oversized inputs return an empty source value with
`max_env_entries_exceeded` or `max_argv_entries_exceeded`.

`loadConfigSources` also accepts an optional partial `ResourceLimitPolicy`. Its
`maxDiagnostics` value bounds retained issues per source and in aggregate.

## Runtime Limit Validation

Direct JavaScript API calls now accept only positive safe integers as limit values.
Missing or invalid values fall back to documented defaults, so `NaN`, `Infinity`,
zero, negative values, and unsafe integers cannot disable a resource bound.

CLI pipeline declarations remain stricter and reject explicitly malformed limits as
declaration errors.

## Loader Result Validation

Custom loaders must return structurally valid `ConfigLoaderResult` values:

- `issues`, when present, is an array of valid `ConfigIssue` entries;
- issue codes begin with a letter and contain at most 128 compatible identifier
  characters;
- issue paths contain only string or safe-integer segments;
- issue details contain only string, finite number, boolean, or null values;
- `locations`, when present, is an array of valid `ValueLocation` entries;
- location line and column values, when present, are positive safe integers.

Malformed structures reject the source as `invalid_loader_result`. Core copies valid
issue and location entries and replaces their `sourceId` with the loader descriptor
id. Adapter exceptions and exceptions raised while inspecting hostile source values
remain data errors with raw exception text omitted.

## CLI Declaration Boundary

The pipeline declaration is limited to 1 MiB before JSON parsing. JSON and dotenv
source paths remain confined to the declaration directory, including canonical
symbolic-link and Windows-junction checks. Valid child directory names beginning
with two dots, such as `..config`, are not treated as parent traversal.

## Compatibility Review

No consumer changes are required for adapters that already follow the published
types. Before upgrading, test custom JavaScript adapters that previously returned
partial issue/location objects or attributed entries to a different source id.
