# Local Onboarding

Status: Unreleased, ADR 0018.

`uce init [--directory <existing-directory>] [--json]` creates `uce.json` with a
defaults port 3000, an explicit APP_PORT environment mapping and a JSON Schema
requiring an integer port between 1 and 65535. Its mapping explicitly selects
safe-integer syntax and rejects present empty APP_PORT values; a missing variable
keeps the default. The directory defaults to the
working directory; it must exist. Creation writes only this one declaration and
does not read environment values, install packages or make network requests.
Run `uce doctor --config uce.json`, then set APP_PORT and rerun it to see overrides
or a validation failure. Edit this declaration to add your actual settings.

Exclusive creation (`wx`, mode 0600 where supported) refuses existing files,
directories and symlinks; there is no overwrite/force flag. A write failure can
leave a partial newly created file, which is retained for inspection rather than
deleted. Initialization never deletes a file. Exit codes are 0 for creation,
4 for an existing file/invalid usage and 2 for a filesystem failure. `init-1` JSON
contains only command, status and a stable code, with no filesystem error prose.

Initialization is dispatched by `runCli` separately from the legacy synchronous
parser and `CliCommand` union, which retain their existing contracts.

## Configuration diagnosis

```sh
uce doctor --config uce.json --json
uce doctor --discover . --profile production --json
```

`doctor` uses the same source loading, coercion, declared validators, profile and
workspace selection as `validate`. Output follows the shared parser's choice:
`--json`, `--output json` and
`--output=json` select JSON; a later `--output human` selects human output.
JSON aliases are retained for usage-error envelopes as well. The command performs
real reads and validation. It never initializes, edits or repairs files
automatically. Source argv after `--`
is forwarded normally. Inspection/diff/policy flags are rejected. Exit categories
match validation: 0 success, 1 schema validation failure, 2 source/declaration
failure, 3 mapping/merge/coercion/resource
failure, 4 usage/profile selection failure (redaction failure retains exit 5).

`doctor-1` JSON adds fixed, actionable `fixes` to the existing sanitized
`diagnostics` report. Advice comes from a finite code/category mapping, never
exception/provider prose. Human output includes each sanitized issue's code, path,
source or validator, message and advice. Metadata is JSON-escaped so control
characters cannot become terminal commands. A healthy
result means this selected declaration and validation passed, not that application
connectivity or every unused profile was executed. Diagnostic metadata still
contains source ids, config paths and filenames and is not suitable for public
sharing without the separate public-share projection.

## Help and version

`uce --help` (`-h`), `uce help` and `uce <command> --help` show command and option
guidance without discovering or reading configuration. `uce help <command>` is
also accepted. `uce --version` (`-v`) reads the installed CLI package version.
These standalone forms exit 0 and write text to stdout; tokens after `--` retain
their meaning as source arguments.
