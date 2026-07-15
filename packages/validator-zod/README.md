# @0disoft/universal-config-engine-validator-zod

Zod validation adapter for Universal Config Engine. It preserves Zod's inferred
output type for adapter-local use while core keeps the resolved pipeline config as
the authoritative output.

## Install

```sh
npm install @0disoft/universal-config-engine-core \
  @0disoft/universal-config-engine-validator-zod zod
```

Node.js `>=24`, ESM, and Zod `^4.4.3` are required.

## Use

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

console.log(validation.ok);
```

`ValidatorResult.value` is adapter-local typed output. It does not replace the
pipeline config and is not passed to later validators.

See the [validator adapter contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/README.md)
and [typed output decision](https://github.com/0disoft/universal-config-engine/blob/main/docs/adr/0009-validator-typed-output-boundary.md).

## License

MIT
