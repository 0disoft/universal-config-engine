# Application declaration loading

Status: Unreleased.

Applications and CLI commands use the Node package's `loadConfig` implementation
for declaration reading, profiles/inheritance, source loading, coercion, limits
and validation. Applications do not need to import the CLI or construct loaders.

```js
import { loadConfig } from "@0disoft/universal-config-engine-node";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";

const pipeline = await loadConfig({
  configPath: "uce.json",
  cwd: process.cwd(),
  workspacePath: process.cwd(),
  env: process.env,
  argv: [],
  validatorFactory: createAjvValidator
});
if (!pipeline.result.ok || pipeline.report.status !== "ok") {
  // Handle the sanitized report; do not log result.config.
}
```

Install the core and Node packages. Add the Ajv adapter only when using declared
JSON schemas. Node does not depend on Ajv, its adapter, or CLI. A declaration with
validators and no factory fails with `validator_factory_missing`; it never skips
validation silently. Factory errors become safe `validator_compile_failed`
diagnostics, with original causes available only through optional private
`onError` observers. Factory diagnostics carry `validatorId` separately from input
source status. Existing CLI declaration/source/profile/compiler exports remain
available as compatibility wrappers.

`cwd` and `env` default to the process values; `argv` defaults to an empty array.
Pass explicit values for deterministic execution. `profile`, `workspacePath` and
`allowedRootPath` retain declaration-reader behavior. `signal` reaches bounded
file I/O and validators and is checked between source stages. It cannot interrupt
synchronous JSON parsing or make a third-party callback release resources.
The existing local file limits and declaration graph budgets still apply.

`loadConfig` returns `{ result, report }`, including normalized declaration errors.
`validate` defaults to true; setting it to false is intended for provenance-only
explanations, not validated application configuration. Validator compilation is
deferred until successful resolution and sufficient remaining provenance budget.

For typed application output, use `loadValidatedConfig({ ...options,
outputValidator })`. It always runs declared validation, then the output validator,
returning discriminated `{ ok: true, value, result, report }` or `{ ok: false,
result, report }`. Output stays separate from resolved config and may contain
secrets. Duplicate validator IDs fail, and no typed value is returned on failure.
Core's `validateConfigOutput(pipeline, validator, options?)` supports this final
stage for an already resolved pipeline without loading its sources again.

Reload/watch callbacks can call `loadConfig({ ...options, ...operation })` to
forward cancellation. See the [complete example](../../examples/adoption/library.mjs)
and [reload contract](reload.md) for resource ownership and disposal.
