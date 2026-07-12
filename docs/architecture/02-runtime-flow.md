# Runtime Flow

Status: Draft

## Boundary

Runtime flow covers local resolution only. It does not include a hosted API, database
persistence, remote config delivery, telemetry, feature flag evaluation, or secret
manager behavior.

## Flow

1. A caller declares sources with ids, kinds, priorities, display names, and redaction
   policy input.
2. Loaders return normalized config values, source locations, and loader issues.
   Loader issue arrays are bounded as they enter the pipeline, both per source and
   in aggregate.
3. Declared override mappings translate process env or argv source values into target
   config paths.
4. Resource limits bound file size, object depth, key count, diagnostics count, path
   length, environment entry count, and argument entry count. Environment and argv
   limits are enforced before declared mappings are evaluated.
5. Unsafe path segments are rejected or escaped before object mutation.
6. The merge engine resolves values in deterministic priority order and emits
   provenance events as values are defined, overridden, defaulted, or rejected.
7. Optional coercion rules transform values and emit coercion provenance or issues.
   The final resolved config is then checked again against depth, key-count, and
   path-length limits so merge aggregation and JSON coercion cannot bypass them.
8. Validator adapters receive the normalized config object and return normalized
   issues.
9. The result builder returns resolved config to the caller and sends reportable data
   through a redaction-aware diagnostic builder.
10. CLI commands format the same pipeline result as human output or versioned JSON.

Library consumers may call these stages independently or use `runConfigPipeline`.
The facade stops before validator execution when resolution already failed and
returns the final `ConfigResult` together with its `DiagnosticReport`.

## Redaction Flow

Resolved config may contain raw values for the direct library caller. Diagnostic
reports must not. A report builder must derive redacted representations from secret
metadata before report structures are created. Replacing strings at final output time
is not sufficient.

## Quality Attributes

- Maintainability: library and CLI must execute the same resolution pipeline.
- Security: diagnostic reports are secret-safe, not necessarily public-safe.
- Operability: source-aware issues must be bounded and actionable.
- Compatibility: parser and validator behavior must stay behind adapters.
