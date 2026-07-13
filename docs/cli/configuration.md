# CLI Configuration

Status: Draft
Repository Type: cli-tool

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Command contract: `docs/cli/command-contract.md`
- Technical owner: UNASSIGNED
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## CLI Configuration Model

The CLI should inspect the same pipeline model used by the library. It must not
invent a second config resolution path.

CLI inputs:

- a JSON pipeline declaration file;
- default source entries;
- JSON config file paths;
- simple `.env` file paths;
- explicit env mapping;
- CLI override mapping;
- inline Ajv JSON Schema validators for `validate`;
- output mode selection.

JSON file and dotenv file paths are resolved from the pipeline declaration
directory. The resolved path must stay inside that directory. Absolute file paths
are accepted only when they still point inside the declaration directory. A file
source path that escapes with `..` or points to another absolute location fails as
a `source-load` issue with exit code `2`. Existing paths are checked by canonical
filesystem path, so symbolic links and Windows junctions cannot redirect a source
outside the declaration directory.

The pipeline declaration itself is read through the bounded Node file reader and
must not exceed 1 MiB. Oversized declarations fail before JSON parsing with
`resource-limit/max_file_bytes_exceeded` and exit code `3`.
The CLI retains the canonical identity of the declaration file that was actually
opened and uses its directory for every relative source. Retargeting a declaration
symlink or junction after the read cannot switch the source directory.

The CLI validates the declaration shape before loading sources. Unsupported source
kinds, unknown declaration fields, missing or duplicate source ids, missing file
paths, malformed redaction policies, malformed override mappings, malformed
coercion rules, malformed validator declarations, duplicate validator ids,
source/validator id namespace collisions, malformed resource limits, and malformed
file size policies fail as `source-load` issues with exit code `2`; they are not
silently skipped. File source path boundary failures are also `source-load` issues.
After this validation succeeds, the runtime pipeline uses a normalized declaration
object rebuilt from the validated fields rather than the raw parsed JSON object.
Malformed declaration diagnostics are capped at a fixed bootstrap maximum of 200,
independent of declaration-provided limits. The final retained diagnostic is
`resource-limit/max_diagnostics_exceeded` when additional errors are omitted.

Pipeline `limits` may also declare `maxSources`, `maxProvenanceEvents`,
`maxResolvedPaths`, and `maxReportBytes`. Their defaults are 64, 20,000, 10,000,
and 4 MiB. `maxReportBytes` must be at least 1024. Source count is checked before
declared files or process inputs are loaded; other aggregate overflows produce a
bounded `resource-limit` failure instead of an unbounded report.

Source `displayName` values must be omitted or non-empty strings. Override mapping
`targetPath` and coercion rule `path` declarations are write paths, so they must be
non-empty arrays of string path segments. Numeric path segments remain readable in
diagnostic paths, but array element writes are not part of the current CLI
declaration contract.

## Precedence Rules

The CLI must print or export the source order used for a run. A CLI flag may select
or override sources, but it must not silently change source priority.

Env var and CLI argument mapping must be declared. Automatic name-to-path inference is
out of MVP scope because it hides typos and collisions.

Process environment and argv sources accept optional positive-integer entry limits:
`maxEnvEntries` and `maxArgvEntries`. Both default to 4096 in the Node adapter.
When the complete input exceeds its limit, the source is rejected before mapping and
returns `resource-limit/max_env_entries_exceeded` or
`resource-limit/max_argv_entries_exceeded`; the CLI exits with code `3`. The limit
counts the complete input, not only names referenced by mappings.

Override sources may opt into unmapped-input diagnostics with
`unmappedBehavior: "warning"` or `"error"`. Process-env sources must also declare a
non-empty `unmappedPrefix`; only environment names inside that namespace are
checked. Argv strict mode checks arguments after `--`, reports indexes rather than
raw unknown argument text, and treats positionals as unmapped. Omitting the behavior
preserves the default silent-ignore contract. See ADR 0015.

Within a single process-env or argv source, two mappings must not target the same
config path. Duplicate mapping targets are declaration errors rather than
last-writer-wins overrides.

Mapping target paths also must not overlap by ancestry. For example, `service` and
`service.port` cannot coexist in one source because applying those mappings in a
different order would change or delete values. Such declarations fail as
`pipeline_override_mapping_target_path_overlap` before source loading.

CLI argv source values are read only after the `--` separator. Example:

```text
uce explain --config uce.json -- --port 9000
```

An argv source argument may be provided at most once for each declared mapping.
Duplicate forms such as `--port 9000 --port=8080` are mapping errors, not
first-wins or last-wins overrides.
When a declared argv argument is followed by another flag-like token such as `-v`
or `--verbose`, the argument is reported as missing a value. Negative numeric
values such as `-1` remain valid argument values.

## Fixture Coverage

`packages/cli/fixtures/local-precedence/` covers JSON-file defaults, declared
process env mappings, argv overrides after `--`, source precedence, provenance, and
secret-path redaction in JSON explain output.

`packages/cli/fixtures/coercion-validation/` covers opt-in coercion, declared Ajv
JSON Schema validation, validation provenance, and JSON validate output.

## Validator Declarations

`uce validate` supports first-party Ajv JSON Schema validators in the pipeline
declaration:

```json
{
  "validators": [
    {
      "id": "schema:server",
      "kind": "json-schema-ajv",
      "schema": {
        "type": "object",
        "required": ["server"],
        "properties": {
          "server": {
            "type": "object",
            "required": ["port"],
            "properties": {
              "port": { "type": "integer", "minimum": 1024 }
            }
          }
        }
      }
    }
  ]
}
```

Validator code is not loaded from declaration file paths, package names, or URLs.
Zod and custom validators stay in the library API until a future ADR defines a safe
declaration format.

## Secret Handling

Secret values are redacted by default. A command may report that a value came from
an environment variable, secret source, or redacted path, but it must not print the
raw value unless a future ADR explicitly defines a safe debug mode.

When an override mapping sets `secret: true`, the CLI treats that mapping target as
a redaction `secretPath` for the source. This is true even when the target path name
does not match a default secret-name pattern.

Declared `secretPaths` redact the declared path and its descendants. For example,
`["database"]` covers `["database", "clientId"]` even though `clientId` is not a
default secret-name pattern.

Redacted reports can still contain sensitive metadata. CLI documentation must avoid
describing report output as safe to paste into public issues.

## Deferred

- Pipeline declarations remain JSON-only for `0.x`. A future format requires an
  ADR, parser ownership, fixtures, and declaration-normalization coverage.
