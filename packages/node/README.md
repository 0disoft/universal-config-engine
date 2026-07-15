# @0disoft/universal-config-engine-node

Bounded Node.js source adapters for Universal Config Engine. The package provides
JSON file, simple dotenv file, process environment, and argv sources while keeping
filesystem and process APIs outside the core package.

## Install

```sh
npm install @0disoft/universal-config-engine-core @0disoft/universal-config-engine-node
```

Node.js `>=24` and ESM are required.

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

Process-env and argv adapters use explicit mappings and bounded entry counts.
Strict unmapped-input diagnostics are opt-in.

See the [compatibility contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/compatibility.md)
and [public API contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/public-api.md).

## License

MIT
