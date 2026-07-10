# ADR 0008: CLI File Source Path Boundary

Status: Accepted
Owner: UNASSIGNED

## Purpose

Define the filesystem boundary for CLI `json-file` and `dotenv-file` source paths.

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- CLI command contract: `docs/cli/command-contract.md`
- CLI configuration: `docs/cli/configuration.md`
- Related ADR: `docs/adr/0004-cli-command-and-pipeline-declaration.md`

## Decision

The CLI treats the directory containing the pipeline declaration file as the trust
boundary for declared file sources.

For `json-file` and `dotenv-file` sources:

- relative paths resolve from the pipeline declaration directory;
- absolute paths are allowed only when they still resolve inside the declaration
  directory;
- paths that resolve outside the declaration directory are rejected before file
  loading with `source-load/pipeline_file_source_path_outside_config_directory`;
- the declaration and existing source paths are compared by canonical filesystem
  path, so symbolic links and Windows junctions cannot redirect a source outside
  the declaration directory;
- rejected file source paths produce exit code `2`.

This rule applies before JSON or dotenv parsing and before config merge.

## Rationale

Pipeline declarations can be reviewed, copied, or executed in CI. If a declaration
can use `../` or an arbitrary absolute path, a contributor-controlled declaration
can cause the CLI to read files that are outside the reviewed config bundle. Local
users could still read those files directly, but the CLI should not make path
traversal an implicit feature of the pipeline format.

The declaration directory is a small, understandable boundary. It keeps portable
config bundles self-contained and avoids introducing a broader project-root or
workspace-root discovery rule.

## Consequences

- Config bundles that previously referenced sibling or parent directories must
  move those files under the declaration directory or generate a declaration in a
  shared parent directory.
- The CLI does not currently provide an escape hatch for outside paths. A future
  ADR may add an explicit option if a safe use case needs it.
- This rule does not change the lower-level Node package APIs; direct library users
  can still choose their own file paths.

## Validation

- CLI tests must cover rejection for `..` traversal outside the declaration
  directory.
- CLI tests must cover allowed absolute paths that stay inside the declaration
  directory.
- CLI tests must cover symbolic-link or junction traversal to a canonical target
  outside the declaration directory.
- `pnpm run check` must pass before release.

## Review Blockers

- File source paths can escape the declaration directory without an explicit ADR.
- Path rejection emits raw file contents or secrets.
- File source path failures use an unrelated exit code.
