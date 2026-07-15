# @0disoft/universal-config-engine-core

Deterministic configuration resolution with source precedence, value-level
provenance, structured validation, resource limits, and secret-safe diagnostics.
This package has no runtime dependencies and does not read files, environment
variables, or command-line arguments by itself.

## Install

```sh
npm install @0disoft/universal-config-engine-core
```

Node.js `>=24` and ESM are required.

## Quick Start

```js
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";

const { result, report } = await runConfigPipeline({
  loaders: [
    {
      descriptor: {
        id: "defaults",
        kind: "defaults",
        priority: 0,
        displayName: "defaults"
      },
      load() {
        return { value: { service: { port: 3000 } } };
      }
    },
    {
      descriptor: {
        id: "local",
        kind: "object",
        priority: 10,
        displayName: "local"
      },
      load() {
        return { value: { service: { port: 8080 } } };
      }
    }
  ],
  context: undefined
});

console.log(result.config.service.port); // 8080
console.log(report.resolvedPaths[0]?.winningSourceId);
```

Use `resolveConfig`, `runValidators`, and `buildDiagnosticReport` separately when
the application needs to own individual pipeline stages.

## Contract

- Object values deep-merge; arrays replace; explicit `null` overwrites.
- Higher priority wins. Same-priority conflicts emit an issue and the later source wins.
- Validation adapters return `code`, `severity`, and an optional normalized `path`.
- Diagnostic report schema `0.2` is stable for the `1.x` line.
- Secret values must not be copied into issue messages, details, or provenance.

See the [public API contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/public-api.md),
[1.0 migration guide](https://github.com/0disoft/universal-config-engine/blob/main/docs/library/migration-1.0.md),
and [repository README](https://github.com/0disoft/universal-config-engine#readme).

## License

MIT
