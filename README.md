# universal-config-engine

Status: Draft
Scope: backend
Repository Type: library
Addons: cli-tool

Universal Config Engine is a local configuration resolution engine. It is designed
for projects that need to explain exactly why a config value resolved to a final
value across defaults, files, environment variables, CLI arguments, and validation
layers.

The goal is not to parse every config format directly. The core owns a deterministic
pipeline, provenance model, merge policy, validation adapter boundary, and secret
redaction rules. JSON object input and simple `.env` loading are the first built-in
surfaces; YAML, TOML, INI, and JSON5 belong behind adapters unless later evidence
justifies built-in support.

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- SECURITY.md: sensitive vulnerability and secret-exposure reporting policy
- .agents/context-map.md: agent route map
- docs/product/02-spec.md: product source of truth
- docs/library/public-api.md: library API ownership
- docs/cli/command-contract.md: CLI command behavior
- packages/cli/fixtures/: executable CLI golden report fixtures
- docs/: design, operations, architecture, and engineering standards
- archive/scaffold/: non-authoritative backend scaffold material retained only for
  reference while the product boundary settles

## Repository Shape Notes

- library: This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.
- cli-tool: This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Product Boundary

Owned:

- Config source registration and ordered resolution.
- Loader adapter contracts for file formats.
- Env var and CLI override mapping.
- Nested object merge policy with value-level provenance metadata.
- Schema validator adapter boundary.
- Diagnostic-first secret redaction for logs, CLI output, and reports.
- A CLI for explaining resolved config without printing secret values.

Not owned:

- Remote config services.
- Feature flag rollout platforms.
- Secret managers, encryption, rotation, or cloud KMS clients.
- Template rendering engines.
- Direct parsers for every config file dialect.
- Application server or database persistence behavior.

## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore keep line endings, binary diffs,
local files, build outputs, caches, and secret files under control.

## Install

For library usage:

```powershell
pnpm add @0disoft/universal-config-engine-core
```

For the local inspection CLI:

```powershell
pnpm add --save-dev @0disoft/universal-config-engine-cli
```

These are package-consumer commands. Repository contributors should use the
validation and release commands documented in `VALIDATION.md` and
`docs/ops/release.md`.

## Library Quickstart

```javascript
import {
  buildDiagnosticReport,
  resolveConfig
} from "@0disoft/universal-config-engine-core";

const result = resolveConfig({
  sources: [
    {
      descriptor: {
        id: "defaults",
        kind: "object",
        priority: 0,
        displayName: "defaults"
      },
      value: { service: { port: 3000 } }
    },
    {
      descriptor: {
        id: "local",
        kind: "object",
        priority: 10,
        displayName: "local"
      },
      value: { service: { port: 8080 } }
    }
  ]
});

const report = buildDiagnosticReport(result);
console.log(result.config.service.port); // 8080
console.log(report.resolvedPaths);
```

[`examples/basic-library.mjs`](examples/basic-library.mjs) is the executable form
of this flow and is run against packed workspace tarballs by the package smoke test.

## CLI Quickstart

Create a JSON pipeline declaration such as [`examples/uce.json`](examples/uce.json),
then run:

```powershell
pnpm exec uce explain --config examples/uce.json --json
```

Run validation with any validators declared in the pipeline:

```powershell
pnpm exec uce validate --config examples/uce.json --json
```

Pass CLI source values after `--` so they are treated as config input rather than
UCE options:

```powershell
pnpm exec uce explain --config examples/uce.json --json -- --host 0.0.0.0
```

## Workspace Development

Run `explain` with a JSON pipeline declaration:

```powershell
pnpm --filter @0disoft/universal-config-engine-cli exec uce explain --config uce.json --json
```

Run `validate` with declared validators:

```powershell
pnpm --filter @0disoft/universal-config-engine-cli exec uce validate --config uce.json --json
```

Pass CLI source values after `--` so they are treated as config input rather than
UCE options:

```powershell
pnpm --filter @0disoft/universal-config-engine-cli exec uce explain --config uce.json --json -- --host 0.0.0.0
```

Current JSON report fixtures cover success, validation failure, source-load
failure, mapping failure, JSON usage errors, and secret-path redaction. Exit codes
are `0` for success, `1` for validation failure, `2` for source loading or parser
adapter failure, `3` for merge/mapping/coercion/resource-limit policy failure, `4`
for CLI usage errors, and `5` for redaction policy failure.

## Current Decision State

The product direction is documented. ADR 0003 selects TypeScript, ESM output, Node
`>=24`, a pnpm workspace, and a zero-runtime-dependency core package. ADR 0004
selects `@0disoft/universal-config-engine-cli`, binary name `uce`, commands `explain` and
`validate`, JSON pipeline declarations, and JSON report schema version `0.1`.
Initial validator adapters are `@0disoft/universal-config-engine-validator-zod` and
`@0disoft/universal-config-engine-validator-ajv`. ADR 0005 selects the MIT license,
the `@0disoft` npm scope, and a manual validation-gated release baseline. ADR 0007
supersedes routine manual publication with tag-driven Trusted Publisher
automation. The
`v0.1.0` GitHub release carries pre-publication inspection assets; `v0.1.1` is the
first npm publication baseline, and the current package version is `0.2.1`. CLI
golden fixtures cover
local precedence, opt-in coercion, declared
Ajv validation, validation failure, source-load failure, mapping policy failure,
JSON usage errors, and secret-path redaction.

## Current Structure Warning

Archived `api`, `db`, and backend documentation scaffold files are not product
contracts. They do not imply an HTTP API, database schema, migration surface, auth
model, or hosted service. Any future server or persistence surface requires a new
ADR before it can move out of `archive/scaffold/`.
