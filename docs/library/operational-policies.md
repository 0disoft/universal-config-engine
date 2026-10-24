# Optional input and comparison policies

Status: Unreleased. Existing defaults are unchanged.

## Numeric and empty-input mapping

Mappings support `numberFormat` when `parseAs` is `number`:

| Format | Accepted input |
| --- | --- |
| omitted / `javascript` | Existing finite Number() conversion, including whitespace, hex and exponents |
| `decimal` | A sign and digits with an optional fractional part; finite base-10 numbers |
| `integer` | A sign and digits only, within the JavaScript safe-integer range |

Strict modes reject surrounding whitespace, hex, exponents, `.5` and `1.`.
Leading zeroes and signs are accepted; decimal fractions require digits on both
sides of the dot. Decimal mode still uses JavaScript double precision; use integer
mode when integer precision matters. All modes reject non-finite results. Syntax
failures use `mapping_number_format_invalid`; unsafe integers use
`mapping_integer_out_of_range`. Messages do not include input values.

`emptyValue` controls present whitespace-only input for any mapping type:
`parse` (default) retains the old conversion, `ignore` leaves the path unset in
that source, and `error` reports `mapping_empty_value`. Missing variables remain
absent even in error mode. Ignored input does not reserve a mapping target; declared
secret policies still apply. Node env/argv and JSON declarations share this policy.

```json
{
  "externalName": "APP_PORT", "sourceKind": "process-env",
  "targetPath": ["server", "port"], "parseAs": "number",
  "numberFormat": "integer", "emptyValue": "error"
}
```

The generated init example explicitly selects these strict port settings.

## Selected comparison dimensions

`buildConfigDiff(before, after, { comparison })` accepts optional `values`,
`sources` and `locations` booleans. Missing fields default to true; at least one
must be enabled. `values` includes type changes; `sources` compares winning and
overridden IDs/priorities; `locations` compares paths, lines and columns.
Location-only comparisons exclude source IDs. Additions/removals are always
reported. The existing `source-changed` kind represents selected provenance
changes, preserving default output. Explicit selections appear in `comparison`.

```js
buildConfigDiff(before, after, {
  comparison: { values: true, sources: true, locations: false }
}); // Ignore location-only edits; retain value/type and ownership changes.
```

The CLI equivalent is `uce diff --config before.json --against after.json
--compare values,sources --json`. Selections filter comparisons; they do not
remove diagnostic/source metadata or change value visibility.

CI policies own their comparison settings:

```json
{
  "version": "change-policy-1",
  "comparison": { "values": true, "sources": false, "locations": false },
  "rules": [{ "id": "stable-port", "path": ["server", "port"], "mode": "forbid-changes" }]
}
```

This blocks value/type changes and path additions/removals while allowing source
and location changes. `require-path` and `allowed-sources` always enforce their
own conditions. Caller options cannot narrow CI comparisons; the CLI rejects
`--compare` with `--policy`. Unknown fields, non-boolean flags and all-false
settings fail closed.

With value comparison enabled, existing explicit `detectSecretChanges` and
indeterminate failures remain unchanged. Metadata-only checks deliberately make
no claim about secret value changes and do not request in-memory secret comparison.
Do not use metadata-only settings to enforce value immutability.
