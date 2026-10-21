# Profiles and Local Inheritance

Status: Implemented, unreleased (ADR 0018). Published `1.2.0` is unchanged.

Pipeline declarations may contain at most 64 named `profiles`. Each profile may
add `sources`, `validators`, `coercionRules` and override individual `limits`.
Names start with an ASCII letter, contain only letters/digits/hyphens/underscores,
are at most 64 characters and cannot be prototype-related keys. Nested profiles,
arbitrary fields and profile-local inheritance are rejected.

```json
{
  "sources": [{ "id": "defaults", "kind": "object", "priority": 0, "value": { "port": 80 } }],
  "profiles": {
    "production": {
      "sources": [{ "id": "production", "kind": "object", "priority": 10, "value": { "port": 443 } }]
    }
  }
}
```

`selectPipelineProfile(declaration, "production")` compiles the selected sources,
validators and coercion rules after base entries, overrides explicitly named
resource limits and returns a normalized concrete declaration. Omitting the name
uses only the base. Process environment and `NODE_ENV` never select a profile.

Source priorities are retained exactly; selection does not silently raise them.
Sources/validators keep their own ids, source locations and provenance. Duplicate
ids, source/validator collisions and combined source-limit violations fail instead
of replacing entries. All profiles must satisfy the declaration shape, including
unused profiles. Oversized profile maps and profile source arrays are rejected
before their entries are inspected. An unknown selection is
`usage/pipeline_profile_not_found` with no echoed input value.

The compiler does not load files or mutate the provided declaration. Use the
existing declared-source loading and shared core pipeline to execute its result.

## Local inheritance

A declaration can declare `extends: ["base.json", "other.json"]`. Parents resolve
relative to the declaring file, depth-first in list order, before that file's own
entries. A shared ancestor contributes once. Cycles, duplicate source/validator
ids and aggregate source limits fail before any config source is loaded. Source
priorities are unchanged; child entries do not automatically win.

At most eight parent references per file, sixteen unique declaration files,
1 MiB per declaration and 4 MiB total are read. Each file must be a JSON pipeline
declaration. The default boundary is the top declaration's canonical directory;
parents and data files outside it are rejected, including symlink escapes.

`loadPipelineDeclarationContext(path, cwd, { workspacePath, profile })` explicitly
widens the boundary to a selected workspace and selects a profile. Matching profile
pieces in each ancestor and child are included; the name must exist in at least
one document. Parent limits are merged in order and child/profile limits override
individual fields. All profiles are shape-checked even when not selected.

The returned context includes `workspacePath`, ordered `declarationPaths` and
`sourceConfigPaths` for inherited declarations. Pass these through to
`loadDeclaredSources` along with `configPath: context.canonicalConfigPath`, `cwd`,
`env` and `argv`. File sources retain their own declaration-relative bases. The
plain `loadPipelineDeclaration` helper returns compiled absolute source paths;
callers must still forward their explicit workspace to the source loader. These
are local paths, not permission capabilities: opened-file checks run again.

## CLI selection

```sh
uce validate --config services/api/uce.json --workspace . --profile production --json
uce explain --discover . --profile production --values --json
uce diff --config before.json --against after.json --workspace . --profile production --json
```

`--profile` and `--workspace` are optional, single-use options for explain,
validate and diff. Diff applies the same selection to both declarations; each must
declare the selected profile. `--discover` supplies its own workspace and cannot
be combined with `--workspace` or `--config`. Values after `--` remain source argv.
Unknown profiles exit 4, declaration/read failures exit 2, schema validation
failures exit 1 and mapping/merge/coercion/resource failures exit 3. Omitting
selection retains the base declaration even if `NODE_ENV` is set.
The exported synchronous `parseCliArgs` legacy contract remains unchanged;
`runCli` performs opt-in file selection before running the shared pipeline.
