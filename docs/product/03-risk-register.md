# Risk Register

Status: Draft
Owner: UNASSIGNED

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The package tries to parse every config format directly. | Maintenance grows faster than product value. | Keep core format-agnostic and require adapter contracts for non-core formats. |
| Parser dialect differences are hidden behind one fake universal API. | Users get surprising behavior and broken config. | Preserve loader identity, source metadata, and adapter-specific failure categories. |
| Secret values leak through diagnostics or CLI JSON output. | Logs and CI artifacts may expose credentials. | Redact by default and require explicit secret metadata before output generation. |
| Redaction is implemented as final string replacement. | Secret values may already exist inside report objects, snapshots, or thrown errors. | Build diagnostic values from redaction metadata and never store raw secret values in report structures. |
| Env var and CLI override precedence is implicit. | Debugging production config becomes guesswork. | Require declared mapping and ordered source priority. |
| Env var and CLI mappings are inferred automatically. | Typos, collisions, and naming conventions become invisible behavior. | Require declared mappings and report unmapped inputs separately. |
| Parent and child override mapping paths overlap. | Mapping order can silently replace or delete nested values. | Reject equal and ancestor/descendant target paths before applying mappings. |
| Type coercion silently changes values. | Invalid config can look valid. | Make coercion policy explicit and visible in provenance. |
| Deep merge behavior is ambiguous. | Nested config may be partially overwritten or accidentally retained. | Document merge policy and produce conflict diagnostics. |
| Unsafe keys mutate prototypes during merge or mapping. | Config input can become a security vulnerability. | Reject or safely escape `__proto__`, `prototype`, and `constructor` path segments before mutation. |
| Large or malicious config input exhausts memory or floods diagnostics. | CLI and CI usage can fail unpredictably. | Enforce limits for file size, object depth, key count, diagnostics count, path length, environment entry count, and argument entry count before expensive processing. |
| Validator adapters validate raw parser output instead of normalized config. | Error paths and semantics drift across formats. | Validator adapters must receive normalized config plus source path metadata. |
| Scope expands into feature flags, secret managers, or remote config. | The project becomes a platform instead of a small library. | Require an ADR before expanding beyond local config loading and inspection. |
| Archived backend scaffold is mistaken for product scope. | Contributors may implement an API server or DB layer prematurely. | Keep scaffold material under `archive/scaffold/` and require ADRs before restoring active API or DB docs. |
