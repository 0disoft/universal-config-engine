# Portable Core Consumers

Status: Verified locally for unreleased ADR 0018 development, Windows x64,
2026-10-21. This does not change the published 1.2.0 package or its engine policy.

| Runtime | Actual version tested | Scope |
| --- | --- | --- |
| Node | 24.14.0 | Installed core; all five packages separately covered by packed consumers |
| Bun | 1.4.3 | Installed core ESM consumer |
| Deno | 2.9.7 | Installed core, explicit local node_modules, no registry downloads during execution |
| workerd | 1.20261021.1 / 2026-10-21 | Installed core module bytes in an actual Worker test handler; no Node compatibility flags |

The shared consumer checks typed asynchronous Standard Schema output, coercion,
override provenance, secret-safe reports, value inspection, public projection,
comparison and resource failure. It imports built npm tarball contents, not source
TypeScript. These cases do not constitute exhaustive runtime certification.
Node adapters, filesystem watching and the CLI continue to require Node APIs and
the declared Node >=24 floor; core results do not extend that promise to them.
Local workerd is not a hosted Cloudflare deployment or a test of platform bindings.

## Reproduce

Prepare the runtimes yourself; the command does not install or download them:

```powershell
$env:UCE_BUN_BIN = 'C:/tools/bun.exe'       # optional when already on PATH
$env:UCE_DENO_BIN = 'C:/tools/deno.exe'
$env:UCE_WORKERD_BIN = 'C:/tools/workerd.exe'
pnpm run smoke:portable-runtimes
# Explicit subset, never silently treated as a complete matrix:
pnpm run smoke:portable-runtimes --runtimes=node,bun
```

The command builds and packs core, installs that tarball into a fresh consumer,
runs selected runtimes serially with 30-second process timeouts, then removes its
scratch/build outputs even after failure. Missing selected executables fail early.
No server, watcher, network socket or hosted workflow is started. Workerd runs its
bounded `test` command with compatibility date `2026-10-21`.

`.tmp/portable-runtime-evidence.json` records actual versions, tarball SHA-256,
platform and selected passes. Its version field is package metadata, not a claim
that local unreleased changes were published under that version. Rerun it against
the final source before making release claims. No new CI jobs were added.

Primary runtime references: [Deno installation](https://docs.deno.com/runtime/getting_started/installation/),
[workerd runtime and configuration](https://github.com/cloudflare/workerd),
[Worker test example](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/tests/url-test.wd-test).
