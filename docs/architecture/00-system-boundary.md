# System Boundary

Status: Draft

## Boundary

Universal Config Engine is a local configuration pipeline, not a hosted service.

Owned boundaries:

- config source registration;
- loader adapter contracts;
- normalized config object shape;
- source priority and merge policy;
- env var and CLI override mapping;
- typed coercion hooks;
- validator adapter handoff;
- provenance and redaction diagnostics;
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

## Runtime Flow

The pipeline starts with declared sources, loads them through loaders, applies explicit
override mappings, merges with provenance, validates normalized output, and returns a
redacted diagnostic report alongside the resolved config.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: diagnostics must not reveal raw secret values.
- Operability: failures must include source identity and recovery guidance.
- Compatibility: format-specific parser behavior must stay behind adapters.
