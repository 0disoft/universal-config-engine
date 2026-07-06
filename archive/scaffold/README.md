# Archived Scaffold Material

Status: Non-authoritative

This directory keeps backend scaffold material that came from the original
repository template. It is retained for history only.

These files do not define product scope for Universal Config Engine:

- `api/` does not define an implemented HTTP API.
- `db/` does not define an implemented database schema, migration system, or seed
  contract.
- `docs-backend/` does not define authentication, authorization, persistence,
  logging, API, migration, or backend-security ownership.

The active product is a local configuration resolution library plus a thin CLI
inspection surface. Any future hosted API, database persistence, or backend runtime
must be introduced by an ADR and moved back into active documentation deliberately.
