# Migration To 0.5

The `0.5` line adds aggregate execution budgets to the public resource-limit
contract.

## ResourceLimitPolicy

Code that constructs a complete `ResourceLimitPolicy` object must add:

```ts
{
  maxSources: 64,
  maxProvenanceEvents: 20_000,
  maxResolvedPaths: 10_000,
  maxReportBytes: 4 * 1024 * 1024
}
```

Callers that pass `Partial<ResourceLimitPolicy>` need no source change. Missing
fields use the defaults above. CLI JSON consumers must tolerate the four new fields
under `limits`.

Pipelines exceeding a new limit now fail with `resource-limit` diagnostics. An
oversized diagnostic report is replaced by a valid bounded error report; consumers
must not assume a successful resolution always implies `report.status === "ok"`.
