# Public validation constraints

Status: Unreleased.

Ajv and Zod adapters accept `includeConstraints: true` when the application's
schema metadata is explicitly safe to disclose. The default is false. Pipeline
JSON validator declarations accept the same boolean. The generated init example
opts in for its public port bounds.

```js
const validator = createAjvValidator({
  schema: { type: "integer", minimum: 1, maximum: 65535 },
  includeConstraints: true
});
```

Failures may carry a typed `constraint`: a fixed expected type, a finite numeric
bound/size/multiple, or a required/additional-properties rule. Core copies only
allowlisted fields. Doctor shows this metadata next to the issue path and origin.
Unknown rules, non-finite limits, regex patterns, enum values, received data,
custom messages and provider prose are omitted. Zod publishes representable
number/string/array bounds; unsupported origins remain ordinary issues.

Schema limits themselves may be sensitive. Opt in only after deciding they are
public. Even opted-in constraints are removed from secret-associated diagnostic
reports. The public-share projection removes all constraint metadata, including
constraints on public paths. `result.config`, validator output and unsanitized
in-memory issue lists remain application-private.

Custom `ValidatorAdapter` implementations may explicitly supply a typed
`ValidatorIssue.constraint`; `normalizeValidatorConstraint` offers the same safe
projection. Normalization does not turn arbitrary schema metadata into public data.
Standard Schema's supported issue contract contains message/path, not structured
limits. Its adapter continues to omit prose and does not guess constraints from
messages. Use the dedicated provider adapter or an explicit custom adapter when
structured constraints are required.
