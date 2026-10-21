# Local Onboarding

Status: Unreleased, ADR 0018.

`uce init [--directory <existing-directory>] [--json]` creates `uce.json` with a
minimal empty defaults source. The directory defaults to the working directory;
it must exist. No package installation, source discovery, environment mapping or
network request occurs. Edit this declaration to add your actual settings.

Exclusive creation (`wx`, mode 0600 where supported) refuses existing files,
directories and symlinks; there is no overwrite/force flag. A write failure can
leave a partial newly created file, which is retained for inspection rather than
deleted. Initialization never deletes a file. Exit codes are 0 for creation,
4 for an existing file/invalid usage and 2 for a filesystem failure. `init-1` JSON
contains only command, status and a stable code, with no filesystem error prose.

Initialization is dispatched by `runCli` separately from the legacy synchronous
parser and `CliCommand` union, which retain their existing contracts.
