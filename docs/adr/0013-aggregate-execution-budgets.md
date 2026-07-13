# ADR 0013: Aggregate Execution Budgets

Status: Accepted

## Context

Depth, key, path, and diagnostic limits bound individual config structures and
issue arrays, but they do not bound source descriptors, retained provenance,
resolved-path reports, or the final serialized diagnostic report. A valid pipeline
can therefore remain within every old limit while retaining substantially more
metadata than a caller intended.

## Decision

`ResourceLimitPolicy` adds four positive safe-integer limits:

- `maxSources`, default `64`;
- `maxProvenanceEvents`, default `20,000`;
- `maxResolvedPaths`, default `10,000`;
- `maxReportBytes`, default `4 MiB` and minimum `1 KiB`.

Source count is checked before resolution. The CLI also checks it before loading
declared sources. Provenance is bounded while merge and validation events are
created. The resolved-path index remains complete while merge decisions are made,
because truncating that internal index would change conflict semantics; only the
retained public result is capped, and the existing `maxKeyCount` bounds the internal
index. Exceeding any retained-entry limit produces a stable `resource-limit` issue
and makes the result fail.

`buildDiagnosticReport` performs redaction first and then measures the compact UTF-8
JSON representation. An oversized report is replaced with a fixed-shape error report
containing `resource-limit/max_report_bytes_exceeded`; raw or partially truncated
JSON is never returned. The minimum byte budget guarantees that this fallback report
itself fits.

## Consequences

- The new fields are observable in `ConfigResult.limits` and CLI JSON output, so the
  change belongs in the next pre-1.0 minor release.
- Direct JavaScript callers with missing or invalid limits receive defaults. CLI
  declarations reject malformed values and reject `maxReportBytes` below `1024`.
- This ADR does not add source locations to reports. Location retention must consume
  these budgets in a separate versioned report-schema change.
