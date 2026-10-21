# Official Configuration File Loaders

Status: Implemented, unreleased (ADR 0018). These additions are not in published
`1.2.0`. Strict `loadJsonFileSource` retains its existing behavior.

`@0disoft/universal-config-engine-node` exports `loadConfigFileSource` for explicit
`json`, `jsonc`, `yaml`, `toml` and `json5` formats. Core remains format-agnostic.
The Node package owns `jsonc-parser` 3, `yaml` 2, `smol-toml` 1 and `json5` 2;
the extra parsers load on demand, and the lockfile records exact reviewed versions.

```ts
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import { loadConfigFileSource } from "@0disoft/universal-config-engine-node";

const source = await loadConfigFileSource({
  descriptor: { id: "settings", kind: "adapter", priority: 10, displayName: "settings" },
  filePath: "/app/settings.yaml",
  allowedRootPath: "/app",
  format: "yaml"
});
const result = resolveConfig({ sources: [source] });
```

## Contract

- All formats reuse the opened-file identity/root verification and default 1 MiB
  byte limit. Missing/unreadable inputs produce `config_file_read_failed`; parser
  failures produce `config_file_parse_failed`. Raw input and exception text are
  omitted. Existing file-policy issue codes remain unchanged.
- New dialects require a plain JSON-compatible object. Structural validation uses
  the existing default resource limits or the provided `limits`. Unsafe own keys,
  non-finite numbers, dates and other non-JSON runtime values reject the whole
  source before values are handed to the pipeline. Failure returns an empty value
  and bounded issues, never a partially parsed configuration.
- JSON remains strict. JSONC permits comments, rejects malformed/unterminated
  tokens and requires explicit `allowTrailingComma: true` for trailing commas.
  Native JSON parsing preserves prototype-like own keys so core can report
  `unsafe_key`; the tolerant parser's partial/mutated objects are never returned.
- JSONC retains JSON-style bounded value locations, including comment line offsets.
  YAML/TOML/JSON5 preserve source identity but currently provide no per-value line
  coordinates; callers must not infer them from unrelated sources.
- JSONC/JSON5 nesting is scanned before parser execution and capped at the smaller
  of the configured depth plus root and 256 containers. Excess produces
  `max_parse_depth_exceeded`. Structural depth/path/key limits also apply after
  parsing. File bytes bound input to all dialect parsers; parser failures are
  contained, including internal recursion failures.
- YAML uses YAML 1.2 with unique string keys. Duplicate keys, aliases, unknown tags,
  parser warnings and custom runtime values are rejected. Anchors without aliases
  do not expand configuration. Merge-key magic and custom schemas are not enabled.
- TOML date/time objects, big integers and non-finite numbers are unsupported.
  Use quoted strings for dates and JSON-compatible numeric ranges. Do not silently
  convert dates or precision-sensitive values into a different type.

The generic loader's `json` branch delegates to `loadJsonFileSource`; its legacy
diagnostic codes and normalization timing remain unchanged. Pass matching limits
to the loader and the pipeline when overriding structural budgets.

Parser and loader boundaries are covered by executable Node package tests,
including hostile syntax, unsafe keys, malformed comments, aliases, resource
budgets and JSONC coordinates. CLI integration and discovery are separate units.
