# Documentation

Status: Draft

## Source of Truth

- Product scope source: docs/product/02-spec.md
- Archived backend scaffold reference: archive/scaffold/
- Architecture decisions source: docs/adr/*.md
- Operational standard source: docs/ops/00-operational-contract.md
- Validation source: VALIDATION.md
- Agent routing source: .agents/context-map.md
- Repository hygiene source: .editorconfig, .gitattributes, .gitignore
- Library public API source: docs/library/public-api.md
- Library semver source: docs/library/semver.md
- Library compatibility source: docs/library/compatibility.md
- 0.3.x migration guide: docs/library/migration-0.3.md
- Adapter ecosystem source: docs/adapters/README.md
- CLI command contract source: docs/cli/command-contract.md
- CLI output and exit-code source: docs/cli/output-and-exit-codes.md
- CLI config source: docs/cli/configuration.md

## Non-Authoritative Scaffold

The archived `api`, `db`, and backend documentation files under `archive/scaffold/`
are retained only to preserve scaffold history. They are not source of truth for an
HTTP API, database schema, authentication model, authorization policy, migration
strategy, or hosted service. Product decisions must come from `docs/product`,
`docs/architecture`, `docs/library`, `docs/cli`, and ADRs.
