# @0disoft/universal-config-engine-validator-ajv

Ajv JSON Schema validation adapter for Universal Config Engine. Validation runs on
the normalized config object after source resolution and coercion.

## Install

```sh
npm install @0disoft/universal-config-engine-core \
  @0disoft/universal-config-engine-validator-ajv ajv
```

Node.js `>=24`, ESM, and Ajv `^8.20.0` are required.

## Use

```js
import { runValidators } from "@0disoft/universal-config-engine-core";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";

const validator = createAjvValidator({
  id: "service-schema",
  schema: {
    type: "object",
    required: ["service"],
    properties: {
      service: {
        type: "object",
        required: ["port"],
        properties: { port: { type: "integer", minimum: 1 } }
      }
    }
  }
});

const validation = await runValidators({
  config: { service: { port: 8080 } },
  provenance: [],
  validators: [validator]
});

console.log(validation.ok);
```

Ajv instance paths are normalized into Universal Config Engine paths. Numeric-looking
object keys remain strings unless traversal proves that the parent is an array.

Standard Ajv keyword diagnostic codes are preserved. Custom keywords that do not
match the core's bounded ASCII code grammar use `ajv_custom_keyword` instead.
Their raw keyword names and Ajv error prose are omitted from diagnostics.

This adapter accepts synchronous Ajv `Schema` values. `$async: true` schemas are
rejected during adapter creation, including for JavaScript callers, before any
validation Promise can run. Synchronous schemas keep their existing result shape.

See the [validator adapter contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/adapters/README.md).

## License

MIT
