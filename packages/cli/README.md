# @0disoft/universal-config-engine-cli

Local `uce` commands for explaining and validating Universal Config Engine pipeline
declarations. The CLI emits human-readable output or a versioned JSON envelope and
never provides a raw-secret display mode.

## Install

```sh
npm install --save-dev @0disoft/universal-config-engine-cli
```

Node.js `>=24` and ESM are required.

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

## License

MIT
