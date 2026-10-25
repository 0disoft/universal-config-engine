# @0disoft/universal-config-engine-validator-zod

Zod validation adapter for Universal Config Engine. It preserves Zod's inferred
output type for adapter-local use while core keeps the resolved pipeline config as
the authoritative output.

## Install

```sh
npm install @0disoft/universal-config-engine-core \
  @0disoft/universal-config-engine-validator-zod zod
```

Node.js `>=24`, ESM, and patched Zod `^4.6.6` are required.

## Use

Since 1.3, `includeConstraints: true` retains explicitly public types and
number/string/array bounds. It defaults to false; provider prose and received data
remain private. Core removes constraints from secret-associated reports.
See the [constraint contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/validator-constraints.md).

```ts
import { runValidators } from "@0disoft/universal-config-engine-core";
import { createZodValidator } from "@0disoft/universal-config-engine-validator-zod";
import { z } from "zod";

const validator = createZodValidator({
  id: "service-schema",
  schema: z.object({
    service: z.object({ port: z.number().int().positive() })
  })
});

const validation = await runValidators({
  config: { service: { port: 8080 } },
  provenance: [],
  validators: [validator]
});

console.log(validation.issues);
```

`ValidatorResult.value` is adapter-local typed output. It does not replace the
pipeline config and is not passed to later validators.

Schemas may contain asynchronous refinements or transforms. The adapter waits for
validation to finish and returns a Promise for both synchronous and asynchronous
schemas. Always `await validator.validate(...)` when calling the adapter directly;
`runValidators` and `runConfigPipeline` already await it. Each parse runs once.
Ordinary validation failures preserve structured issue codes and paths. Rejected
refinement/transform Promises reach core's `validator_threw` boundary, which omits
exception details; direct adapter callers receive a rejected Promise instead.

See the [validator adapter contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/README.md)
and [typed output decision](https://github.com/0disoft/universal-config-engine/blob/main/docs/adr/0009-validator-typed-output-boundary.md).

## License

MIT
