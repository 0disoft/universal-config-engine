# Risk Register

Status: Draft
Owner: UNASSIGNED

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The package tries to parse every config format directly. | Maintenance grows faster than product value. | Keep core format-agnostic and require adapter contracts for non-core formats. |
| Parser dialect differences are hidden behind one fake universal API. | Users get surprising behavior and broken config. | Preserve loader identity, source metadata, and adapter-specific failure categories. |
| Secret values leak through diagnostics or CLI JSON output. | Logs and CI artifacts may expose credentials. | Redact by default and require explicit secret metadata before output generation. |
| Env var and CLI override precedence is implicit. | Debugging production config becomes guesswork. | Require declared mapping and ordered source priority. |
| Type coercion silently changes values. | Invalid config can look valid. | Make coercion policy explicit and visible in provenance. |
| Deep merge behavior is ambiguous. | Nested config may be partially overwritten or accidentally retained. | Document merge policy and produce conflict diagnostics. |
| Validator adapters validate raw parser output instead of normalized config. | Error paths and semantics drift across formats. | Validator adapters must receive normalized config plus source path metadata. |
| Scope expands into feature flags, secret managers, or remote config. | The project becomes a platform instead of a small library. | Require an ADR before expanding beyond local config loading and inspection. |
