# Inspect Values and Check Configuration Changes

Status: Implemented, unreleased (ADR 0017). These commands are available in the
development checkout, not the published `1.1.2` packages.

The examples assume `uce` is installed from this checkout's built package. To try
them directly from the repository, run `pnpm run build`, then replace `uce` with
`node packages/cli/dist/main.js`. Validation/smoke commands clean build output, so
build again before trying the examples after those commands.

## Inspect One Setting

```sh
uce explain --config examples/comparison/before.json --path '["service","port"]' --json
```

This selects the numeric port, its winning source and retained override history,
source location when available, coercion events and declared validation results.
Use `--values` instead of `--path` to inspect the entire resolved configuration.
Root is `[]`; arrays use numeric indexes (`["clients",0,"name"]`), while a literal
object key `"0"` stays a string. Dots and slashes in keys are not separators.
JSON output uses `inspection-1`. A missing path exits `4`. Failed resolution or
validation emits no effective values. Default legacy `explain` remains metadata-only.

Public strings are previews capped at 1024 UTF-16 code units, with `truncated: true`
when shortened. Nonempty and empty containers use type markers, not embedded raw
objects. Secret containers are opaque, and secret descendants of otherwise public
arrays are individually redacted. Queries inside atomic secret arrays inherit
their source policy. Terminal text is JSON-escaped to prevent control sequences.

## Compare Two Configurations

```sh
uce diff --config examples/comparison/before.json --against examples/comparison/after.json --json
```

The example reports a removed `service.enabled`, a changed `service.port` and its
new winning source `deployment`. Both declarations are resolved and validated,
sequentially, with the same current process environment and argv following `--`.
For historical environments, create explicit declaration snapshots; diff does not
reconstruct past environment variables or overwritten raw values.

JSON uses `diff-1`; successful comparison exits `0` even when differences exist.
Change kinds are `added`, `removed`, `type-changed`, `value-changed` and
`source-changed` (including priority, override history and retained locations).
Arrays are positional, not keyed collections; inserting an element can change
several indexes. Container type changes and their child additions/removals are
separate entries. Object property order does not count as a value change.
Displayed string previews never affect full-value comparisons. `--path` can
narrow a comparison when no policy is supplied.

Both sides' secret policies protect both displayed values. Secret comparisons are
skipped by default and `uncomparedSecretPaths` makes this uncertainty explicit.
`--detect-secret-changes` opts into in-memory comparison and disclosure of changed
metadata only. It never emits raw secret values, lengths, hashes or fingerprints.
Source identities, paths, value types and existence can remain visible even when
values are hidden; these outputs are secret-safe, not public-safe.

## Fail CI on Unsafe Changes

```sh
uce diff --config examples/comparison/before.json --against examples/comparison/after.json --policy examples/comparison/policy.json --json
```

This example deliberately exits `3` with three policy violations. The JSON envelope
is `change-check-1`, containing `diff` and `policy` results. No remote service or
new hosted workflow is needed; invoke this command in an existing CI step.

Policy format:

```json
{
  "version": "change-policy-1",
  "rules": [
    { "id": "stable-port", "path": ["service","port"], "mode": "forbid-changes" },
    { "id": "required-enabled", "path": ["service","enabled"], "mode": "require-path" },
    { "id": "defaults-only", "path": ["service"], "mode": "allowed-sources",
      "allowedSourceIds": ["defaults"] }
  ]
}
```

- `forbid-changes`: rejects value, type, existence or source changes intersecting
  the path. Unknown secret changes fail as `comparison_indeterminate`; explicitly
  enable secret-change detection when this rule covers secret paths.
- `require-path`: requires the exact path in the new config; null counts as
  present. This can check existence inside secret containers without printing them.
- `allowed-sources`: constrains the winning source of existing paths under the
  prefix, including atomic-array ownership. It does not require a path to exist;
  combine with `require-path` when needed.

Policies always evaluate the entire config; combining `--policy` with `--path`
is rejected. Invalid schema exits `4`; policy-file read/JSON errors exit `2` and
omit raw input/parser messages. File overflow and comparison/report limits exit
`3`. Ordinary source and validation failures keep existing exit categories and
cannot produce a passing policy, even with an empty rule list.

CLI path JSON is limited to 16 KiB before parsing. Policy files are limited to
1 MiB. Core accepts up to 256 unique machine-identifier
rules, 256 typed path segments, 4096 UTF-8 bytes per serialized path and 64 allowed
source ids (1–1024 characters each). Unknown fields, duplicate ids and unsafe path
segments are errors. Inspection counts containers against `maxResolvedPaths`;
diff counts the combined set of paths. Combined compact JSON must fit the smaller
input `maxReportBytes`. On overflow all value-bearing output is discarded; fixed
error envelopes may exceed an extremely small byte limit.

## Library Use

```ts
import { buildConfigInspection, buildConfigDiff, checkConfigChanges }
  from "@0disoft/universal-config-engine-core";

// before/after are ConfigResult objects from runConfigPipeline or resolveConfig.
const setting = buildConfigInspection(before, { path: ["service", "port"] });
const comparison = buildConfigDiff(before, after);
const check = checkConfigChanges(before, after, {
  version: "change-policy-1",
  rules: [{ id: "required-port", path: ["service", "port"], mode: "require-path" }]
});
```

The core APIs have no parser, filesystem or CLI dependencies. Validators still do
not replace resolved config with their typed/transformed output (ADR 0009).
Legacy `parseCliArgs` and `CliCommand` retain their two-command contract; use
`runCli` or the installed executable for the new comparison command.
