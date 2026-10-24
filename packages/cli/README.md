# @0disoft/universal-config-engine-cli

Local `uce` commands for explaining and validating Universal Config Engine pipeline
declarations. The CLI emits human-readable output or a versioned JSON envelope and
never provides a raw-secret display mode.

## Install

```sh
npm install --save-dev @0disoft/universal-config-engine-cli
```

Node.js `>=24` and ESM are required.
The stable baseline is **1.2.0**. Normal installation selects the stable `latest`
tag; the historical `1.2.0-rc.1` candidate is not needed.

## Use

Create a JSON pipeline declaration:

```json
{
  "sources": [
    {
      "id": "defaults",
      "kind": "object",
      "priority": 0,
      "value": { "service": { "port": 3000 } }
    }
  ]
}
```

Then run:

```sh
npx uce explain --config uce.json --json
npx uce validate --config uce.json --json
```

Arguments intended for an argv config source must appear after `--`:

```sh
npx uce explain --config uce.json --json -- --port 8080
```

Exit codes are stable for `1.x`: `0` success, `1` validation, `2` source or parse,
`3` policy, `4` usage, and `5` redaction policy. JSON output contains diagnostic
report schema `0.2`.

See the [command contract](https://github.com/0disoft/universal-config-engine/blob/main/docs/cli/command-contract.md)
and [pipeline configuration reference](https://github.com/0disoft/universal-config-engine/blob/main/docs/cli/configuration.md).

## Inspection and Comparison (1.2)

Version 1.2 adds opt-in `explain --values`, typed `--path` queries,
`diff --config before.json --against after.json` and CI checks with `--policy`.
These features are in stable 1.2.0. Legacy commands keep schema
`0.2`; new output uses `inspection-1`, `diff-1` or `change-check-1`. Secret values
remain hidden and secret comparisons require explicit opt-in. See the
[inspection and diff guide](https://github.com/0disoft/universal-config-engine/blob/main/docs/cli/inspection-and-diff.md).

## Unreleased on main

The source checkout additionally contains init/doctor, public-share reports,
file-format adapters, discovery, profiles/inheritance and reload/watch examples.
These additions are not part of the published 1.2.0 API. Follow the
[source-checkout adoption example](https://github.com/0disoft/universal-config-engine/blob/main/examples/adoption/README.md)
to try them; install instructions above target the stable release.

## License

MIT
