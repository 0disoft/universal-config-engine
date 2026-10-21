# Public-Share Diagnostic Reports

Status: Unreleased, ADR 0018. The legacy `0.2` report is secret-safe but contains
private metadata and is not a public-share format.

`buildPublicDiagnosticReport(diagnosticReport)` returns `public-diagnostic-1`.
The input is the existing bounded diagnostic report. Projection constructs fresh
objects from an allowlist; it never spreads an input object into public output.

Retained fields are status, source kind/load status, issue category/severity,
provenance action, resolved-path redaction state and relationships between entries.
Original source/validator ids become `source-1`, `source-2`, etc. Typed config paths
become `path-1`, `path-2`, etc. A repeated identity has the same alias in that report.
Aliases are ordinal, not hashes, and cannot correlate separate reports reliably.
Unknown enum strings become `other` (invalid statuses fail closed).

Scalar values, priorities, source names, original ids/paths, filenames, locations,
issue codes/messages/details, provenance prose and arbitrary extension properties
are omitted. Issue codes are also excluded because user adapters can define them.
Resource limit values are not copied. Projected JSON is bounded by the input's
`maxReportBytes`; overflow returns an empty error envelope with `truncated: true`.
The fixed error envelope may exceed a smaller-than-envelope byte budget.

This permits public debugging of structure and relationships while intentionally
losing field names and specific error codes. Counts, kinds, order, redaction state
and override relationships remain visible and can reveal application structure.
It is a defined metadata projection, not a claim of statistical anonymization.
Review that remaining information before sharing. Never attach raw config or
private alias maps to a public report.
