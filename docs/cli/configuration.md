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

The CLI validates the declaration shape before loading sources. Unsupported source
kinds, unknown declaration fields, missing or duplicate source ids, missing file
paths, malformed redaction policies, malformed override mappings, malformed
coercion rules, malformed validator declarations, duplicate validator ids,
source/validator id namespace collisions, malformed resource limits, and malformed
file size policies fail as `source-load` issues with exit code `2`; they are not
silently skipped.

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

Within a single process-env or argv source, two mappings must not target the same
config path. Duplicate mapping targets are declaration errors rather than
last-writer-wins overrides.

CLI argv source values are read only after the `--` separator. Example:

```text
uce explain --config uce.json -- --port 9000
```

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

Redacted reports can still contain sensitive metadata. CLI documentation must avoid
describing report output as safe to paste into public issues.

## Open Decisions

- Non-JSON pipeline declaration formats: UNDECIDED.
