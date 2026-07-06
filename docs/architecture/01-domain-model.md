# Domain Model

Status: Draft

## Boundary

The domain model is centered on explanation, not parsing. The final config object is
only one output. Each resolved path must also carry enough metadata to explain source
identity, priority, override chain, coercion, validation, and redaction status.

## Core Entities

- `ConfigValue`: normalized JSON-compatible value accepted by the core pipeline.
- `ConfigPath`: ordered string or numeric path segments into a config value.
- `ConfigSourceDescriptor`: stable source id, kind, display name, priority, and
  redaction policy input.
- `LoadedSource`: normalized value plus source locations and loader issues.
- `OverrideMapping`: declared process env or argv name mapped into a config path.
- `MergePolicy`: deterministic policy for object, array, scalar, null, and unsafe
  key behavior.
- `ProvenanceEvent`: value-level event created during definition, override, default,
  coercion, validation, or redaction.
- `ValidatorAdapter`: boundary that maps validator results to config issues over the
  normalized config object.
- `ConfigIssue`: bounded, source-aware issue for load, parse, map, merge, coerce,
  validate, redact, or resource-limit failures.
- `DiagnosticReport`: redacted explanation structure for CLI, logs, CI, and agents.

## Default Policy Direction

- Object values deep-merge.
- Arrays replace; they do not concatenate by default.
- Scalars from higher-priority sources replace lower-priority values.
- Explicit `null` overwrites previous values.
- `undefined` is not a `ConfigValue`.
- `__proto__`, `prototype`, and `constructor` path segments are rejected or safely
  escaped before mutation.
- Coercion is opt-in and must produce provenance.

## Quality Attributes

- Maintainability: source identity and path behavior must stay stable across adapters.
- Security: redacted diagnostic structures must not contain raw secret values.
- Operability: every failure should include source identity and recovery context.
- Predictability: merge behavior must be deterministic and fixture-backed.
