# ADR 0015: Strict Unmapped Input Policy

Status: Accepted

## Context

Process environment and argv adapters intentionally map only declared names. The
default silent ignore behavior is compatible with shared host environments, but it
also hides misspelled application inputs. Treating every host environment variable
as an error would make strict mode unusable because variables such as `PATH`, `CI`,
and shell metadata are not application configuration.

## Decision

Process-env and argv source inputs add optional `unmappedBehavior` with values
`warning` or `error`. Absence preserves the existing ignore behavior.

Process-env strict mode additionally requires a non-empty `unmappedPrefix`. Only
names beginning with that prefix are checked against active process-env mappings.
Names outside the prefix are ignored. Supplying a prefix without a behavior, or a
behavior without a valid prefix, is an error in both direct Node calls and CLI
declarations.

Argv strict mode checks every argument after the CLI `--` boundary. A recognized
split flag consumes its following value. An unknown option followed by a value
produces one issue for the option, not a second issue for its value. Positional
entries are independently unmapped.

Warnings preserve mapped values and allow a successful result. Errors reject the
source before merge. `unmapped_env_entry` includes only the environment variable
name, never its value. `unmapped_argv_entry` includes only `argumentIndex`; unknown
argument text is omitted because it may contain a secret.

## Consequences

- Strict behavior is opt-in and does not change existing consumers.
- Environment namespaces become explicit policy rather than inferred naming.
- The argv adapter performs an additional trie-backed linear scan in strict mode;
  the existing benchmark covers default and strict-warning modes through 4,096
  mappings.
