# Profiles and Local Inheritance

Status: Profile compilation implemented, unreleased (ADR 0018). File inheritance
and CLI selection are separate following units. Published `1.2.0` is unchanged.

Pipeline declarations may contain at most 64 named `profiles`. Each profile may
add `sources`, `validators`, `coercionRules` and override individual `limits`.
Names start with an ASCII letter, contain only letters/digits/hyphens/underscores,
are at most 64 characters and cannot be prototype-related keys. Nested profiles,
arbitrary fields and profile-local inheritance are rejected.

```json
{
  "sources": [{ "id": "defaults", "kind": "object", "priority": 0, "value": { "port": 80 } }],
  "profiles": {
    "production": {
      "sources": [{ "id": "production", "kind": "object", "priority": 10, "value": { "port": 443 } }]
    }
  }
}
```

`selectPipelineProfile(declaration, "production")` compiles the selected sources,
validators and coercion rules after base entries, overrides explicitly named
resource limits and returns a normalized concrete declaration. Omitting the name
uses only the base. Process environment and `NODE_ENV` never select a profile.

Source priorities are retained exactly; selection does not silently raise them.
Sources/validators keep their own ids, source locations and provenance. Duplicate
ids, source/validator collisions and combined source-limit violations fail instead
of replacing entries. All profiles must satisfy the declaration shape, including
unused profiles. Oversized profile maps and profile source arrays are rejected
before their entries are inspected. An unknown selection is
`usage/pipeline_profile_not_found` with no echoed input value.

The compiler does not load files or mutate the provided declaration. Use the
existing declared-source loading and shared core pipeline to execute its result.
