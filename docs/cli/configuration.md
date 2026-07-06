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
- output mode selection.

## Precedence Rules

The CLI must print or export the source order used for a run. A CLI flag may select
or override sources, but it must not silently change source priority.

Env var and CLI argument mapping must be declared. Automatic name-to-path inference is
out of MVP scope because it hides typos and collisions.

CLI argv source values are read only after the `--` separator. Example:

```text
uce explain --config uce.json -- --port 9000
```

## Secret Handling

Secret values are redacted by default. A command may report that a value came from
an environment variable, secret source, or redacted path, but it must not print the
raw value unless a future ADR explicitly defines a safe debug mode.

Redacted reports can still contain sensitive metadata. CLI documentation must avoid
describing report output as safe to paste into public issues.

## Open Decisions

- Validator adapter selection: UNDECIDED.
- Non-JSON pipeline declaration formats: UNDECIDED.
