# Local Adoption Delivery Verification

Date: 2026-10-21. Decision: [ADR 0018](../adr/0018-local-config-adoption.md).
All nine implementation units in the [roadmap](../product/01-roadmap.md) are
complete. The initial delivery ended at `5b42ed025d495c572272aae60ddf3172cc232de6`;
the resumed completion audit below covers three subsequent corrections. This record
adds documentation only. Work used the existing main checkout, with
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

## Resumed completion audit

Audit source: `49b5f6eb96222730b208aeb8eb78099bff4b1a29`.
The previous goal turn made implementation progress. On resumption, the original
attached feedback, ADR 0017/0018, roadmap, contracts, implementation and regression
cases were inspected again instead of accepting the completion checklist alone.
Current branch/worktree inspection found only main and this original checkout.

| Original requirement | Inspected implementation | Behavioral evidence |
| --- | --- | --- |
| First priority: value explain, typed paths, diff and change reasons | Core `inspection.ts`, `diff.ts`, `change-policy.ts`; CLI inspection/diff dispatch | Core and CLI inspection/diff/policy suites; installed seven-case feature checker and three-rule comparison example |
| JSONC/YAML/TOML/JSON5 official adapters | Node `config-file-loader.ts`, shared bounded file reader, CLI source loading | `config-file.test.ts` and CLI `file-adapters.test.ts`: syntax, unsafe keys, non-finite/runtime types, YAML duplicates/aliases/tags, bytes/depth, JSONC coordinates; installed dialect consumers |
| Explicit configuration discovery | Node `discovery.ts`, CLI `discovery.ts` and opened declaration policy | Node/CLI discovery suites: ordered nearest filenames, canonical selection metadata, directory budget, workspace/symlink boundaries, malformed nearest input, explicit-path compatibility; installed discovery consumer |
| Standard Schema and separate inferred output | Core `standard-schema.ts`, `typed-pipeline.ts`; no core runtime dependencies | Both core suites: one awaited callback, immutable input, path normalization, malformed/bounded failures, no successful value after failure, resolved input preserved; installed strict TS `schema-types.ts` with actual Zod |
| Profiles, inheritance and workspaces | CLI profiles, declaration validation/normalization, inheritance graph and source path resolver | Profile/selection/inheritance suites: explicit selection without NODE_ENV inference, original priorities and identities, origin-relative files, cycles, diamond deduplication, unique ids, source/file/byte caps and root checks; installed profile consumer |
| Safe reload and file watching | Node `reload.ts` and `watch.ts` | Reload/watch suites: one active/one queued load, immutable last-good snapshots, failure and close semantics, secret-free events, atomic replacement, path cap and symlink checks; reentrant callback and caller-mutation regressions below; installed lifecycle example |
| Init, doctor and CI checks | Exclusive init file creation, shared doctor pipeline, existing change policy engine | Init/doctor suites: usable new declaration, no overwrite/symlink follow, sanitized failures/advice, parser output modes; actual installed init/doctor and CI example exits 3 with three exact rule ids |
| Public sharing and metadata masking | Core `public-report.ts` allowlist, CLI `public-output.ts` and error dispatch | Core public-report suite and CLI public-output suite: values, names, ids, paths, locations, codes/prose/details omitted; stable aliases/relationships, enum allowlist and byte failure; private usage strings do not escape the public envelope |
| Node/Bun/Deno/Workers consumers | `smoke-portable-runtimes.mjs`, installed core bytes and shared `portable-core.mjs` exercise | Actual selected runtime executables, seven feature groups each; workerd test handler without Node flags; version/digest evidence. Adapter/CLI Node requirements remain separately stated |
| Adoption and reproducible value demonstration | `examples/adoption`, `examples/comparison`, copied installed `adoption.mjs` | Exact environment winner 9443, inherited YAML/TOML paths, typed output, closed watch/reload handles, public report and three named CI violations asserted against installed tarballs |

Two lifecycle requirements initially contradicted the claimed completion:

- A first `load` callback synchronously calling `refresh()` started two loads.
  Its regression observed two calls where one was required. Commit `c25b1a3`
  claims the running slot before invoking application code; the queued request
  now publishes revision 2 after revision 1, with no overlap or stale overwrite.
- Mutating a caller's `paths` array while watch setup awaited its first filesystem
  operation changed the selected inputs after the 64-path check. Its regression
  changed one valid path into 65 entries including an outside path. Commit
  `54b11fc` validates and copies the bounded selection before the first await;
  later mutations do not affect the selected files or resource boundary.

The CLI output contract also had an inconsistency: split `--output json` emitted
human output, and an explicit human override after JSON still emitted JSON.
The regressions failed against the original implementation. Commit `49b5f6e`
uses the shared parser's final choice and its JSON usage-error context. The
installed adoption fixture now uses the split alias, not just `--json`.

Fresh verification on `49b5f6e` passed, with the commands run serially:

- `pnpm run check`: 503 package tests (core 253, Node 110, CLI 111, Ajv 22,
  Zod 7), 46 script tests, strict typechecking, unchanged public declaration
  snapshot, secret/adapter/action guards and deterministic complexity checks.
- `pnpm run smoke:packages`: five actual tarballs and installed JS/strict TS,
  formats, profiles, discovery, init/doctor (including split JSON output), public
  projection, typed output, reload/watch disposal and exact CI violations.
- `pnpm run smoke:consumer-matrix`: independent core/strict TS/Node/Ajv/Zod/CLI
  consumers, including the updated installed adoption example.
- `pnpm run smoke:portable-runtimes`: Node 24.14.0, Bun 1.4.3, Deno 2.9.7 and
  workerd 2026-10-21 passed all seven shared core feature groups again. The core
  tarball digest remained `2dfa2e0883d79ebc6cffc5c136dca201880d47ec2a76dfc0cfe703294fd66a1d`;
  the corrections affect Node/CLI behavior, not core bytes.

Authoritative fresh command logs are ignored `.tmp/completion-audit-{check,
packages,matrix,portable}.log`; failing-before/fixed-after regression logs use
the same prefix. Historical results above remain tied to their earlier commits.
The current audit exercised the requirement-specific behavior listed in the table;
it did not use a test count or a checked roadmap alone as completion proof.

No required implementation unit remains. Publication of new work, hosted Actions
on the unpublished commits, external adoption/score measurements and a hosted
Workers deployment were not performed or claimed. They are not implementation
gates for this local-only objective. Public API shape, DB/schema, dependencies,
hygiene configuration and hosted workflows were unchanged by these corrections.
Source-of-truth updates are the reload/onboarding contracts, changelog and this
audit record. Applied skills: bugfix, library-package, cli-tool and ops-change.
