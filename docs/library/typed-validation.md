# Standard Schema and Typed Validation

Status: Standard Schema adapter implemented, unreleased (ADR 0018). These exports
are not in published `1.2.0`. The separate typed pipeline facade is the next unit.

Core exports `createStandardSchemaValidator` and a minimal structural
`StandardConfigSchema<TOutput>` compatible with
[Standard Schema v1](https://standardschema.dev/schema). No runtime provider or
specification package is added to core. Use a provider implementing `~standard`,
including Zod 4, or supply a structurally compatible schema directly.

```ts
import { z } from "zod";
import { createStandardSchemaValidator } from "@0disoft/universal-config-engine-core";

const schema = z.object({ port: z.coerce.number().positive() });
const validator = createStandardSchemaValidator({ schema, id: "settings-schema" });
const checked = await validator.validate({ config: { port: "443" }, provenance: [] });
// checked.value, when present, has inferred type { port: number }.
```

The adapter awaits each schema invocation once, handles synchronous and async
providers identically and keeps transformed output adapter-local. Existing
`runConfigPipeline` still returns resolved config and does not apply schema output
or pass it to later validators (ADR 0009). A successful direct result may explicitly
contain `value: undefined` when the schema output permits it.

Provider prose is never retained. Failures use `standard_schema_issue` with copied
typed config paths. Standard Schema path wrappers `{ key }` are unwrapped; strings
stay strings, numeric indexes must be nonnegative safe integers, and symbols,
sparse paths or paths longer than 256 segments produce
`standard_schema_invalid_path`. Malformed or contradictory provider results fail
closed with `standard_schema_invalid_result`.

Retained issues default to 200, configurable via `maxIssues`, with a hard cap of
10,000. Invalid values use the default. Overflow reserves the last retained slot
for `standard_schema_issues_truncated`; discarded provider entries are not read.
The pipeline's configured diagnostic budget still applies to adapter results.
Provider rejections flow to core's sanitized `validator_threw` result; direct
adapter callers receive a rejected Promise. Unsupported schema versions or missing
validation callbacks are setup errors. Successful values can contain secrets and
are application data, never a safe log/report format.

Tests cover async completion, provider rejection, typed paths, raw-prose omission,
bounded retention and malformed outputs. An isolated packed TypeScript consumer
checks actual Zod 4 inference and execution while preserving resolved input values.
