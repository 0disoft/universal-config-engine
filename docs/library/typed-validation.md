# Standard Schema and Typed Validation

Status: Available in 1.3.0 (ADR 0018). Existing pipeline behavior is unchanged.

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

## A Separate Typed Pipeline

```ts
import { runValidatedConfigPipeline } from "@0disoft/universal-config-engine-core";

const loaded = await runValidatedConfigPipeline({
  context: undefined,
  loaders: [{
    descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
    load: () => ({ value: { port: "443" } })
  }],
  outputValidator: validator
});
if (loaded.ok) {
  const port: number = loaded.value.port;
  // loaded.result.config remains { port: "443" }; reports describe that input.
}
```

`runValidatedConfigPipeline` first runs the ordinary load/resolve/validate pipeline.
Only after it and its report succeed does the distinct `outputValidator` run once,
using core's frozen validation snapshot and aggregate provenance/diagnostic budgets.
It accepts Standard Schema, Zod or any typed `ValidatorAdapter<TOutput>`; the
successful `value` is inferred as `TOutput`. Earlier validators never receive that
output. The report remains schema `0.2` and never includes the typed value.

Check the facade's top-level `ok` before accessing `value`. On any failure that
property is absent, including provider rejection, malformed/contradictory output,
budget exhaustion and report overflow. A successful undefined output retains an
own `value` property; a success flag with no own output is `typed_output_missing`.
The nested `result` remains the ordinary resolution/validation result; its config
is not a cast to the schema's output type. Report overflow can therefore make the
facade fail even when the nested resolution succeeded.

Use a distinct output validator id and do not also register it in `validators`.
Conflicts fail before loading with `usage/typed_validator_id_conflict`. A validator
count that cannot leave room for the output stage is rejected before scanning its
entries. The typed output may contain application secrets, custom transformed
objects or non-JSON values; it is not a diagnostic/export format and must not be
logged as though redacted.
