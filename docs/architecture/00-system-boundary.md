# System Boundary

Status: Draft

## Boundary

Universal Config Engine is a local configuration resolution pipeline, not a hosted
service and not a parser collection.

Owned boundaries:

- config source registration;
- loader adapter contracts;
- normalized config object shape;
- source priority and merge policy;
- env var and CLI override mapping;
- typed coercion hooks;
- validator adapter handoff;
- value-level provenance and redaction diagnostics;
- CLI inspection behavior.

Consumed boundaries:

- parser adapters for dialect-heavy formats;
- validator libraries chosen by consumers;
- file system and environment inputs supplied by the host process;
- calling application runtime policy.

Out of scope:

- cloud secret managers;
- secret rotation;
- remote config delivery;
- feature flag targeting or experimentation;
- template rendering;
- application API servers;
- database migrations.
- authentication and authorization systems.
- persistent report storage or telemetry.

## Runtime Flow

The pipeline starts with declared sources, loads them through loaders, applies explicit
override mappings, merges while emitting provenance, validates normalized output, and
returns a redacted diagnostic report alongside the resolved config.

Redacted reports are secret-safe, not automatically public-safe. They may still name
source ids, file paths, environment variables, config paths, and internal service
labels.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: diagnostics must not reveal raw secret values.
- Operability: failures must include source identity and recovery guidance.
- Compatibility: format-specific parser behavior must stay behind adapters.
- Safety: unsafe path segments and oversized inputs must produce bounded issues.
