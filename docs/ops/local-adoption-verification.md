# Local Adoption Delivery Verification

Date: 2026-10-21. Decision: [ADR 0018](../adr/0018-local-config-adoption.md).
All nine implementation units in the [roadmap](../product/01-roadmap.md) are
complete. Implementation source ends at `5b42ed025d495c572272aae60ddf3172cc232de6`;
this record adds documentation only. Work used the existing main checkout, with
no additional branch or worktree and no publication of the adoption changes.

## Released baseline versus local development

Stable [v1.2.0](https://github.com/0disoft/universal-config-engine/releases/tag/v1.2.0)
was published from `c8630155fc1677350af2115bf8feeac1768e47f3` after its unchanged
runtime candidate `5377ad94fce6ee416922ff7f6925a41b5db0b6fd` passed the release
gates. Stable CI, CodeQL, runtime and consumer workflows passed; dry-run
`39569019887` and publication `39569284418` succeeded. All five registry packages
reported `latest: 1.2.0`, and independently downloaded tarballs matched release
assets and provenance. Public-registry feature consumers and npm signature checks
passed. SBOM and independent verification evidence are attached to that release.

Everything below was developed after stable publication and is **local only**.
Package versions still say 1.2.0 for development; this is not evidence that new
APIs exist in the published version. No further git push, tag or release was made.
A future minor candidate must pass the existing exact-commit promotion gates.

## Independent local units

| Unit | Implementation commits |
| --- | --- |
| Delivery decision | `94caa48` |
| Bounded Node file formats and CLI integration | `7d68274`, `c89e114` |
| Explicit workspace discovery and CLI selection | `e107540`, `cbb8010` |
| Standard Schema and separate inferred output | `6b5f26d`, `842ce61` |
| Profiles, bounded inheritance and CLI selection | `8050ed7`, `859bf9e`, `62e0b0a` |
| Serialized reload and disposable file watching | `1e4b446`, `38d504f` |
| Non-destructive init and shared-pipeline doctor | `48131d1`, `aef095c` |
| Public-share allowlist and CLI failure projection | `f671a9d`, `e75b007` |
| Actual portable runtime artifact consumers | `009df2c` |
| Copyable adoption and CI change-control examples | `90db068` |
| Exclude all redacted-path metadata from public reload counts | `5b42ed0` |

The last correction was found during integration review: default diff intentionally
retains secret type/source/add/remove metadata, so counting every diff entry was
not a public-only count. Reload now excludes changes with either side redacted.
A regression covers secret-only type and source changes with a zero public count.

## Executed validation

All project commands were run serially. Package-specific typechecks/tests and API
snapshot updates covered each unit before its commit. Final evidence:

- `pnpm run check` passed on `5b42ed0`: build, strict package/test typechecking,
  public declaration snapshot, 498 package tests (core 253, node 108, CLI 108,
  Ajv 22, Zod 7), 46 script tests, secret-fixture scan, adapter contracts, action
  pinning and deterministic complexity bounds. Build output cleanup succeeded.
- `pnpm run smoke:packages` passed on `5b42ed0`: five actual local tarballs,
  isolated installation, strict TypeScript and executed JavaScript, legacy CLI
  failure cases, inspection/diff/policies, all four new dialects, discovery,
  profiles/inheritance and the copied adoption example. The example exercises
  init/doctor/public output, actual env precedence, typed output, reload and watch
  disposal; its CI case reports exactly three expected rule violations and exit 3.
- `pnpm run smoke:consumer-matrix` passed on `90db068`: isolated core, strict TS,
  Node, Ajv, Zod and CLI consumers, including that same adoption workflow. The only
  subsequent runtime change was the reload-count correction, then covered by the
  targeted Node suite, full workspace check and final all-package smoke above.
- `pnpm run smoke:portable-runtimes` passed for the unchanged core at `90db068`:
  Node 24.14.0, Bun 1.4.3, Deno 2.9.7 and workerd 2026-10-21. Seven shared feature
  groups ran per runtime on actual installed core contents. Workerd used no Node
  compatibility flags. Core tarball SHA-256:
  `2dfa2e0883d79ebc6cffc5c136dca201880d47ec2a76dfc0cfe703294fd66a1d`.
- `pnpm audit --audit-level=high`: no known vulnerabilities in the workspace graph.
- `pnpm run check:governance --commit c8630155fc1677350af2115bf8feeac1768e47f3`:
  all eight release-commit, action pinning, protection and security-alert checks
  passed. Running the same release-oriented check against unpublished local HEAD
  correctly failed only `preparation-commit`; remote policy/security checks passed.
  No gate was weakened and no push was performed to make an unpublished commit
  appear ready for release.
- `git diff --check` passed and completed implementation changes were committed.

Detailed local logs are in ignored `.tmp/adoption-final-{check,packed,matrix,portable}.log`;
portable version/digest evidence is `.tmp/portable-runtime-evidence.json`.
Stable publication evidence remains under `.tmp/release-1.2.0-evidence/` and on the
GitHub release. These local files are evidence, not maintained product inputs.

## Contracts, ownership and limits

Changed sources of truth: product spec/roadmap, ADR 0018, public API and declaration
snapshot, CLI command/configuration contracts and validation instructions. New
guides cover formats, discovery, typed validation, profiles/inheritance, reload,
onboarding, public sharing and portable runtime scope. The
[adoption example](../../examples/adoption/README.md) is executable in installed
consumers; it is not an application/server scaffold.

Public API changes are additive. Legacy report schema 0.2, synchronous CLI parser,
validator-local output policy and Node >=24 package floor remain intact. Core
still has zero runtime dependencies. Parser dependencies live in Node only:
`yaml` major 2, `smol-toml` major 1 and `json5` major 2, with reviewed lock entries.
DB/schema changes: none. Repository hygiene rules: unchanged. Runner changes:
one opt-in local portable-runtime script and expanded existing consumer fixtures;
no added hosted workflows/jobs or persistent services.

Remaining limits are explicit contracts rather than unfinished implementation:
no executable JS/TS config, recursive auto-scanning, YAML alias expansion, TOML
date objects, automatic profile selection or remote config service. Callers must
provide the watched dependency set and application load deadlines. File watching
is best effort; it is not a filesystem transaction. Private snapshots and typed
values still contain application secrets. Public projections retain structure,
counts and relationships and are not statistical anonymization. Alternate-runtime
evidence covers core only; no hosted Cloudflare deployment was performed.

New local commits have no GitHub Actions result because they were intentionally
not pushed. External project adoption, competitive scores and live production
outcomes were not measured or claimed. Next work is a separately authorized minor
candidate release followed by evidence from a real external integration, rather
than adding unrelated features to fill a maintenance quota.

Applied repository skills: feature, library-package, cli-tool, dependency-upgrade,
ops-change, test-hardening and bugfix. Security/performance and corresponding
package/CLI/ops/dependency checklists guided the boundaries and verification.
