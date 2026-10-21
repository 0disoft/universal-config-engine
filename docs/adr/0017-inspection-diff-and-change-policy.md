# ADR 0017: Safe Inspection, Diff, and Change Policy

Status: Accepted

## Decision

Keep the default `explain`/`validate` output and diagnostic schema `0.2`
unchanged. Add opt-in `explain --values` and `explain --path <JSON array>`
inspection output (`inspection-1`), and `diff --config <before.json> --against
<after.json>` comparison output (`diff-1`). JSON array paths preserve the
difference between numeric array indexes and string object keys, including empty
keys, dots and slashes. `[]` selects the root. A missing query is a usage error.

Core owns inspection, comparison and policy evaluation. CLI only loads both
declarations, invokes the shared pipeline and formats results. Comparison runs
validators for both declarations; opt-in inspection also runs validators. Legacy
`explain` continues to resolve without validation.

Inspection traverses containers without embedding their raw contents. Each entry
contains a path, type, visibility, optional scalar value and the closest available
resolved-source metadata. Arrays are inspected element by element even though
merge provenance treats them atomically. Object containers with mixed origins do
not invent a winning source. Provenance and issues are already sanitized by the
existing diagnostic policy and are filtered to intersect the selected path.

Default secret-name rules, all declared path/name policies, report options and
participating secret-source history apply before retaining scalar values.
Descendants inherit atomic array source policies. Values in failed resolutions
are omitted. Strings are bounded previews with an explicit truncation marker;
containers carry no value. Entry and UTF-8 JSON byte budgets fail closed, without
silently presenting incomplete inspection or diff as successful. These reports
remain secret-safe, not public-safe: names, paths and change metadata are visible.

Diff compares complete values in memory, never truncated previews or serialized
masked reports. It reports additions, removals, scalar value changes, type changes
and source/history changes independently. Containers are structural entries;
their children produce separate changes. Missing and explicit null differ.
Ordering is deterministic. Both sides' policies apply to both displayed values,
including when a secret was removed or its policy changed.

Secret values are not compared by default: the report explicitly marks them
uncompared. An opt-in `--detect-secret-changes` / core option compares them only in
memory and emits a changed flag, never raw values, lengths, hashes or fingerprints.
Structural existence and source changes remain visible. Users must explicitly
accept disclosure of secret-change metadata by enabling this option.

CI policy is an optional bounded JSON file passed to `diff --policy <file>`.
Rules match typed path prefixes and can forbid changes, require paths after
resolution, or constrain winning sources. Core returns structured violations and
the CLI uses existing policy exit code `3`; parse/source/validation/usage failures
retain their existing categories. Incomplete resolution/comparison cannot pass a
policy. Secret-value rules require explicit secret comparison or fail closed as
indeterminate. No remote calls, hooks, executable configuration, baseline writes
or additional CI workflows are introduced.

## Compatibility and Delivery

All existing exports, commands and default JSON envelopes retain their contracts.
New APIs, CLI options, command and report versions are additive opt-in surfaces.
No validator-returned value replaces resolved config (ADR 0009 still applies).
This feature set is intended for a future minor release; package versions are not
bumped or published during local implementation.

Implement and commit sequentially: contract; inspection API and CLI; diff API and
CLI; policy API and CLI. Cover nested secret values, query precision, complete-value
comparison, failed inputs, limits and installed consumers. Preserve legacy golden
reports. Record each completed unit and remaining work in the product roadmap.
