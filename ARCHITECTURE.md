# Architecture

Status: Draft

## Boundary

Universal Config Engine owns config source registration, loader adapter boundaries,
source priority, normalized config objects, merge/coercion policy, validator adapter
handoff, provenance metadata, and secret-safe diagnostics.

It consumes raw config sources and optional parser or validator adapters. It must not
own remote config storage, secret rotation, feature flag rollout, application runtime
state, or database persistence.

## Runtime Flow

1. Register sources with names, priority, loader, and redaction policy.
2. Load each source into a normalized object plus source metadata.
3. Apply declared env var and CLI override mappings.
4. Merge sources in explicit order.
5. Apply default and typed coercion policy.
6. Run validator adapters against the normalized config object.
7. Return resolved config plus diagnostics, provenance, and redacted report data.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: secret values must be redacted from diagnostics by default.
- Compatibility: parser and validator adapters must remain replaceable.
- Operability: CLI output must explain parse, merge, validation, and redaction failures.
- Predictability: source priority, merge policy, and coercion policy must be explicit.
