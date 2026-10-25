# Local Adoption Example

Status: Available in 1.3.0 (ADR 0018).
Use the source checkout below; after a later release this folder can be copied to
a project that installs the matching core, node and Ajv packages (and CLI for
command-line examples).

From the repository root:

```powershell
pnpm run build
node packages/cli/dist/main.js doctor --config examples/adoption/uce.json --workspace examples/adoption --profile production --json
$env:APP_PORT = '9443'
node packages/cli/dist/main.js explain --config examples/adoption/uce.json --profile production --values --json
node packages/cli/dist/main.js doctor --config examples/adoption/uce.json --profile production --public
Remove-Item Env:APP_PORT
```

The original settings are defaults port 3000, YAML port 8080, explicitly selected
production TOML port 443 and an explicitly mapped `APP_PORT` at priority 20. With
the environment command above the winning value is 9443 from `deployment-env`;
provenance retains the lower sources. The mapping keeps the input string and the
declaration explicitly coerces it to a number before schema validation. Both the
CLI and application example apply this rule and the 100-key declaration limit.
Without `--profile` only defaults/YAML apply,
even if `NODE_ENV` or `APP_PORT` exists. YAML paths use the common declaration's
directory; TOML paths use the top declaration's directory. Source ids stay unique.

The library example uses Node `loadConfig` / `loadValidatedConfig`, obtains separate
typed output, performs a serialized refresh and starts/closes a file watcher.
It uses package imports and must run inside an installed consumer, not directly
from this workspace root (which does not depend on its own packages). The packed
smoke below prepares that isolated consumer and runs `node adoption/library.mjs`.
It prints only fixed lifecycle statuses and a public-share diagnostic projection.
Applications no longer import CLI helpers or manually reconstruct pipeline stages.
The Ajv adapter is passed explicitly as the declaration's validator factory.
An application can retain the watcher until shutdown; this example closes every
handle so the demonstration finishes. Supply actual dependencies when changing
the graph. `load` owns real application deadlines and external resources.

For a new project, `uce init` creates defaults, an APP_PORT mapping and a port
schema in one declaration; it does not overwrite files. This checked-in example
adds file sources and profiles. `doctor` reads
and validates the selected setup, but does not fix files or test service health.
See [reload](../../docs/adapters/reload.md), [profiles](../../docs/cli/profiles-and-inheritance.md)
and [public sharing](../../docs/library/public-sharing.md) for the exact limits.

## Reproducible change-control case

```powershell
node packages/cli/dist/main.js diff --config examples/comparison/before.json --against examples/comparison/after.json --json
node packages/cli/dist/main.js diff --config examples/comparison/before.json --against examples/comparison/after.json --policy examples/comparison/policy.json --json
```

The first command succeeds while reporting a port/source change and an enabled
field removal. The second exits 3 and identifies exactly three rules:
`stable-port` (forbidden change), `required-enabled` (removed required path) and
`defaults-only` (winning source is now deployment). The checked-in declarations
are independent inputs; runtime environment is not treated as archived history.
No generic loader benchmark or competitive speed claim is implied.

`pnpm run smoke:packages` copies this complete folder and comparison case into an
isolated consumer, installs actual local tarballs and asserts these results through
the installed CLI and library. The consumer matrix repeats the CLI-package scenario.
This is reproducible local evidence, not an external deployment or adoption claim.
