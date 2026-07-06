# Product Brief

Status: Draft
Owner: UNASSIGNED

## Purpose

Universal Config Engine helps library, CLI, server, and devtool authors build
configuration behavior that is explainable instead of accidental.

Most projects eventually combine defaults, JSON or `.env` files, environment
variables, CLI flags, secret references, and schema validation. The hard part is
not reading bytes from files. The hard part is answering:

- which source won;
- which path was overridden;
- whether a value was coerced;
- where validation happened;
- whether diagnostics can be printed without leaking secrets.

This repository turns those questions into a reusable library contract and a small
CLI inspection surface.

## Target Users

- CLI tool maintainers who need predictable config precedence.
- Backend and devtool maintainers who repeat config merge code across projects.
- Small teams that need provenance and redaction without adopting a remote config
  platform.
- Library authors who want to support project-specific parser and validator choices
  without hard-wiring a single schema library.

## Product Decision

Build a format-agnostic config pipeline first.

The first product surface should favor:

- JSON object input as the normalized internal shape;
- JSON and simple `.env` loaders as built-in candidates;
- parser adapters for YAML, TOML, INI, and JSON5;
- explicit source priority and merge order;
- env var and CLI override mapping;
- provenance metadata for resolved values;
- secret redaction metadata for logs and CLI output;
- validator adapters instead of a new schema standard.

## Non-Goals

- Directly support every config file format.
- Become a secret manager.
- Become a remote config service.
- Become a feature flag platform.
- Provide cloud KMS, Vault, or rotation clients.
- Provide a template engine.
- Hide parser dialect differences behind a fake universal format.

## Source of Truth

- Product specification: `docs/product/02-spec.md`
- Library API contract: `docs/library/public-api.md`
- CLI command contract: `docs/cli/command-contract.md`
- System boundary: `docs/architecture/00-system-boundary.md`
- Validation names: `VALIDATION.md`

## Review Blockers

- The change claims support for a format without an adapter contract and fixtures.
- The change logs, snapshots, or exports raw secret values.
- The change merges config without preserving source provenance.
- The change treats validation of raw parser output as equivalent to validation of
  the normalized config object.
- The change expands into feature flags, secret management, or remote config without
  a deliberate ADR.
