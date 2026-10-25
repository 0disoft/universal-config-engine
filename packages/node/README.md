# @0disoft/universal-config-engine-node

Bounded Node.js source adapters for Universal Config Engine. The package provides
JSON file, simple dotenv file, process environment, and argv sources while keeping
filesystem and process APIs outside the core package.

## Install

```sh
npm install @0disoft/universal-config-engine-core @0disoft/universal-config-engine-node
```

Node.js `>=24` and ESM are required.

## Application Declaration API (Unreleased)

`loadConfig({ configPath, validatorFactory? })` applies declaration profiles,
source loading, coercion, resource limits and validation through the same execution
path as the CLI. `loadValidatedConfig({ ...options, outputValidator })` additionally
returns separate typed application output. Neither requires importing the CLI.
Supply `createAjvValidator` from the optional Ajv adapter when declaring schemas;
missing factories fail explicitly. See the [application loading contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/load-config.md).

## Process Environment Source

```js
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import { createProcessEnvSource } from "@0disoft/universal-config-engine-node";

const envSource = createProcessEnvSource({
  descriptor: {
    id: "env",
    kind: "process-env",
    priority: 20,
    displayName: "environment"
  },
  env: process.env,
  mappings: [
    {
      externalName: "APP_PORT",
      sourceKind: "process-env",
      targetPath: ["service", "port"],
      parseAs: "number"
    }
  ]
});

const result = resolveConfig({ sources: [envSource] });
console.log(result.config.service.port);
```

## File Sources

`loadJsonFileSource` and `loadDotenvFileSource` enforce byte limits. Set
`allowedRootPath` to bind file loading to a canonical directory; the loader verifies
the opened file identity before reading it. The dotenv parser is intentionally
simple and does not perform shell expansion.

JSON source locations also have an independent `maxLocationBytes` budget (default
4 MiB of compact UTF-8 location records). If exceeded, the loader preserves parsed
config values, omits location metadata and returns a
`max_location_bytes_exceeded` warning. This option does not replace file byte or
structural depth/key limits and is not a total JavaScript heap limit.

Process-env and argv adapters use explicit mappings and bounded entry counts.
Strict unmapped-input diagnostics are opt-in.

See the [compatibility contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/compatibility.md)
and [public API contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/public-api.md).

## Additional File Formats (Unreleased)

`loadConfigFileSource({ descriptor, filePath, format })` adds explicit `jsonc`,
`yaml`, `toml` and `json5` loading through the existing bounded file boundary.
Use descriptor kind `adapter` for dialect sources. JSONC trailing commas require
`allowTrailingComma: true`. YAML aliases/custom tags and TOML date/time objects are
rejected; all values must fit the normalized JSON object contract. Parser errors
never include raw exception text. These additions are not in published `1.2.0`.
See the [format contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/official-files.md).

## Automatic Config Watching (Unreleased)

`watchConfig({ configPath, workspacePath, ...loadingOptions })` automatically
tracks declarations, inherited declarations and selected-profile file sources.
It updates bounded subscriptions on reload, retains the last good config and
repair subscriptions after failure, and releases obsolete watches after success.
Call `watched.watcher.close()` during shutdown. Environment/argv updates require
manual refresh. This API is not in published `1.2.0`.
See the [reload contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/reload.md).

## License

MIT
